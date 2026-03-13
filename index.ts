import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { complete } from "@mariozechner/pi-ai";
import type { Api, AssistantMessage, Model, TextContent, ToolCall } from "@mariozechner/pi-ai";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionEntry,
	SessionMessageEntry,
	TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.join(EXTENSION_DIR, "examples");

// =============================================================================
// Types
// =============================================================================

export interface Monitor {
	name: string;
	description: string;
	event: string;
	when: string;
	model: string;
	context: string[];
	steer: string;
	ceiling: number;
	escalate: string;
	excludes: string[];
	template: string;
	patternsFile: string;
	instructionsFile: string;
	dir: string;
	// runtime state
	activationCount: number;
	whileCount: number;
	lastUserText: string;
	dismissed: boolean;
}

export interface ClassifyResult {
	verdict: "clean" | "flag" | "new";
	description?: string;
	newPattern?: string;
}

export interface MonitorMessageDetails {
	monitorName: string;
	verdict: "flag" | "new";
	description: string;
	steer: string;
	whileCount: number;
	ceiling: number;
}

type MonitorEvent = "message_end" | "turn_end" | "agent_end" | "command";

const VALID_EVENTS = new Set<string>(["message_end", "turn_end", "agent_end", "command"]);

function isValidEvent(event: string): event is MonitorEvent {
	return VALID_EVENTS.has(event);
}

// =============================================================================
// Discovery
// =============================================================================

function discoverMonitors(): Monitor[] {
	const dirs: string[] = [];

	// project-local
	let cwd = process.cwd();
	while (true) {
		const candidate = path.join(cwd, ".pi", "monitors");
		if (isDir(candidate)) {
			dirs.push(candidate);
			break;
		}
		const parent = path.dirname(cwd);
		if (parent === cwd) break;
		cwd = parent;
	}

	// global
	const globalDir = path.join(getAgentDir(), "monitors");
	if (isDir(globalDir)) dirs.push(globalDir);

	const seen = new Map<string, Monitor>();
	for (const dir of dirs) {
		for (const file of listMdFiles(dir)) {
			const monitor = parseMonitorFile(path.join(dir, file), dir);
			if (monitor && !seen.has(monitor.name)) {
				seen.set(monitor.name, monitor);
			}
		}
	}
	return Array.from(seen.values());
}

function isDir(p: string): boolean {
	try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function listMdFiles(dir: string): string[] {
	try {
		return fs.readdirSync(dir).filter((f) =>
			f.endsWith(".md") && !f.includes(".patterns.") && !f.includes(".instructions."));
	} catch { return []; }
}

function parseMonitorFile(filePath: string, dir: string): Monitor | null {
	let content: string;
	try { content = fs.readFileSync(filePath, "utf-8"); } catch { return null; }

	const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(content);
	if (!fm.name) return null;

	const name = String(fm.name);
	const contextRaw = fm.context;
	const context: string[] = Array.isArray(contextRaw)
		? contextRaw.map(String)
		: typeof contextRaw === "string"
			? contextRaw.split(",").map((s: string) => s.trim()).filter(Boolean)
			: ["tool_results", "assistant_text"];

	const excludesRaw = fm.excludes;
	const excludes: string[] = Array.isArray(excludesRaw)
		? excludesRaw.map(String)
		: typeof excludesRaw === "string"
			? excludesRaw.split(",").map((s: string) => s.trim()).filter(Boolean)
			: [];

	const event = String(fm.event ?? "message_end");
	if (!isValidEvent(event)) {
		console.error(`[${name}] Invalid event: ${event}. Must be one of: ${[...VALID_EVENTS].join(", ")}`);
		return null;
	}

	return {
		name,
		description: String(fm.description ?? ""),
		event,
		when: String(fm.when ?? "always"),
		model: String(fm.model ?? "claude-sonnet-4-20250514"),
		context,
		steer: String(fm.steer ?? "Fix the issue."),
		ceiling: Number(fm.ceiling) || 5,
		escalate: String(fm.escalate ?? "ask"),
		excludes,
		template: body,
		patternsFile: path.join(dir, `${name}.patterns.md`),
		instructionsFile: path.join(dir, `${name}.instructions.md`),
		dir,
		activationCount: 0,
		whileCount: 0,
		lastUserText: "",
		dismissed: false,
	};
}

// =============================================================================
// Example seeding
// =============================================================================

/**
 * Resolve the project-local monitors directory.
 * Walks up from cwd looking for `.pi/`, or defaults to `<cwd>/.pi/monitors`.
 */
function resolveProjectMonitorsDir(): string {
	let cwd = process.cwd();
	while (true) {
		const piDir = path.join(cwd, ".pi");
		if (isDir(piDir)) return path.join(piDir, "monitors");
		const parent = path.dirname(cwd);
		if (parent === cwd) break;
		cwd = parent;
	}
	return path.join(process.cwd(), ".pi", "monitors");
}

/**
 * If no monitors exist anywhere (project or global), copy bundled examples
 * into the project-local `.pi/monitors/` directory. Never overwrites existing
 * files — only seeds into an empty or non-existent directory.
 *
 * Returns the number of files copied (0 if seeding was skipped).
 */
function seedExamples(): number {
	// check if any monitors already exist
	if (discoverMonitors().length > 0) return 0;

	// check that we have bundled examples to copy
	if (!isDir(EXAMPLES_DIR)) return 0;

	const targetDir = resolveProjectMonitorsDir();
	fs.mkdirSync(targetDir, { recursive: true });

	// if the target already has monitor .md files (even if they failed to parse), don't overwrite
	if (listMdFiles(targetDir).length > 0) return 0;

	const files = fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".md"));
	let copied = 0;
	for (const file of files) {
		const dest = path.join(targetDir, file);
		if (!fs.existsSync(dest)) {
			fs.copyFileSync(path.join(EXAMPLES_DIR, file), dest);
			copied++;
		}
	}
	return copied;
}

// =============================================================================
// Context collection
// =============================================================================

const TRUNCATE = 2000;

function extractText(parts: (TextContent | ToolCall)[]): string {
	return parts.filter((b): b is TextContent => b.type === "text").map((b) => b.text).join("");
}

function extractUserText(parts: string | (TextContent | { type: string })[]): string {
	if (typeof parts === "string") return parts;
	if (!Array.isArray(parts)) return "";
	return parts.filter((b): b is TextContent => b.type === "text").map((b) => b.text).join("");
}

function trunc(text: string): string {
	return text.length <= TRUNCATE ? text : `${text.slice(0, TRUNCATE)} [TRUNCATED]`;
}

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
	return entry.type === "message";
}

function collectUserText(branch: SessionEntry[]): string {
	let foundAssistant = false;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!isMessageEntry(entry)) continue;
		if (!foundAssistant) {
			if (entry.message.role === "assistant") foundAssistant = true;
			continue;
		}
		if (entry.message.role === "user") return extractUserText(entry.message.content);
	}
	return "";
}

function collectAssistantText(branch: SessionEntry[]): string {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isMessageEntry(entry) && entry.message.role === "assistant") {
			return extractText(entry.message.content);
		}
	}
	return "";
}

function collectToolResults(branch: SessionEntry[], limit = 5): string {
	const results: string[] = [];
	for (let i = branch.length - 1; i >= 0 && results.length < limit; i--) {
		const entry = branch[i];
		if (!isMessageEntry(entry) || entry.message.role !== "toolResult") continue;
		const text = extractUserText(entry.message.content);
		if (text) results.push(`---\n[${entry.message.toolName}${entry.message.isError ? " ERROR" : ""}] ${trunc(text)}\n---`);
	}
	return results.reverse().join("\n");
}

function collectToolCalls(branch: SessionEntry[], limit = 20): string {
	const calls: string[] = [];
	for (let i = branch.length - 1; i >= 0 && calls.length < limit; i--) {
		const entry = branch[i];
		if (!isMessageEntry(entry)) continue;
		const msg = entry.message;
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "toolCall") {
					calls.push(`[call ${part.name}] ${trunc(JSON.stringify(part.arguments ?? {}))}`);
				}
			}
		}
		if (msg.role === "toolResult") {
			calls.push(`[result ${msg.toolName}${msg.isError ? " ERROR" : ""}] ${trunc(extractUserText(msg.content))}`);
		}
	}
	return calls.reverse().join("\n");
}

function collectCustomMessages(branch: SessionEntry[]): string {
	const msgs: string[] = [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!isMessageEntry(entry)) continue;
		if (entry.message.role === "user") break;
		const msg = entry.message as Record<string, unknown>;
		if (msg.customType) {
			msgs.unshift(`[${msg.customType}] ${msg.content ?? ""}`);
		}
	}
	return msgs.join("\n");
}

const collectors: Record<string, (branch: SessionEntry[]) => string> = {
	user_text: collectUserText,
	assistant_text: collectAssistantText,
	tool_results: collectToolResults,
	tool_calls: collectToolCalls,
	custom_messages: collectCustomMessages,
};

function hasToolResults(branch: SessionEntry[]): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!isMessageEntry(entry)) continue;
		if (entry.message.role === "user") break;
		if (entry.message.role === "toolResult") return true;
	}
	return false;
}

function hasToolNamed(branch: SessionEntry[], name: string): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!isMessageEntry(entry)) continue;
		if (entry.message.role === "user") break;
		if (entry.message.role === "assistant") {
			for (const part of entry.message.content) {
				if (part.type === "toolCall" && part.name === name) return true;
			}
		}
	}
	return false;
}

// =============================================================================
// When evaluation
// =============================================================================

function evaluateWhen(monitor: Monitor, branch: SessionEntry[]): boolean {
	const w = monitor.when;
	if (w === "always") return true;
	if (w === "has_tool_results") return hasToolResults(branch);
	if (w === "has_file_writes") return hasToolNamed(branch, "write") || hasToolNamed(branch, "edit");
	if (w === "has_bash") return hasToolNamed(branch, "bash");

	const everyMatch = w.match(/^every\((\d+)\)$/);
	if (everyMatch) {
		const n = parseInt(everyMatch[1]);
		const userText = collectUserText(branch);
		if (userText !== monitor.lastUserText) {
			monitor.activationCount = 0;
			monitor.lastUserText = userText;
		}
		monitor.activationCount++;
		if (monitor.activationCount >= n) {
			monitor.activationCount = 0;
			return true;
		}
		return false;
	}

	const toolMatch = w.match(/^tool\((\w+)\)$/);
	if (toolMatch) return hasToolNamed(branch, toolMatch[1]);

	return true;
}

// =============================================================================
// Template rendering
// =============================================================================

function renderTemplate(monitor: Monitor, branch: SessionEntry[]): string | null {
	let patterns: string;
	try {
		patterns = fs.readFileSync(monitor.patternsFile, "utf-8");
	} catch (e: unknown) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") {
			console.error(`[${monitor.name}] Patterns file missing: ${monitor.patternsFile}`);
			return null;
		}
		throw e;
	}
	if (!patterns.trim()) return null;

	let instructions = "";
	try { instructions = fs.readFileSync(monitor.instructionsFile, "utf-8"); } catch { /* optional */ }

	const instructionsBlock = instructions.trim()
		? `\nOperating instructions from the user (follow these strictly):\n${instructions}\n`
		: "";

	const collected: Record<string, string> = {};
	for (const key of monitor.context) {
		const fn = collectors[key];
		if (fn) collected[key] = fn(branch);
	}

	return monitor.template.replace(/\{(\w+)\}/g, (match, key: string) => {
		if (key === "patterns") return patterns;
		if (key === "instructions") return instructionsBlock;
		if (key === "iteration") return String(monitor.whileCount);
		return collected[key] ?? match;
	});
}

// =============================================================================
// Classification
// =============================================================================

function parseVerdict(raw: string): ClassifyResult {
	const text = raw.trim();
	if (text.startsWith("CLEAN")) return { verdict: "clean" };
	if (text.startsWith("NEW:")) {
		const rest = text.slice(4);
		const pipe = rest.indexOf("|");
		if (pipe !== -1) return { verdict: "new", newPattern: rest.slice(0, pipe).trim(), description: rest.slice(pipe + 1).trim() };
		return { verdict: "new", newPattern: rest.trim(), description: rest.trim() };
	}
	if (text.startsWith("FLAG:")) return { verdict: "flag", description: text.slice(5).trim() };
	return { verdict: "clean" };
}

function parseModelSpec(spec: string): { provider: string; modelId: string } {
	const slashIndex = spec.indexOf("/");
	if (slashIndex !== -1) {
		return { provider: spec.slice(0, slashIndex), modelId: spec.slice(slashIndex + 1) };
	}
	return { provider: "anthropic", modelId: spec };
}

async function classifyPrompt(ctx: ExtensionContext, monitor: Monitor, prompt: string, signal?: AbortSignal): Promise<ClassifyResult> {
	const { provider, modelId } = parseModelSpec(monitor.model);
	const model = ctx.modelRegistry.find(provider, modelId);
	if (!model) throw new Error(`Model ${monitor.model} not found`);

	const apiKey = await ctx.modelRegistry.getApiKey(model);
	if (!apiKey) throw new Error(`No API key for ${monitor.model}`);

	const response: AssistantMessage = await complete(
		model as Model<Api>,
		{ messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
		{ apiKey, maxTokens: 150, signal },
	);

	return parseVerdict(extractText(response.content));
}

// =============================================================================
// Pattern learning
// =============================================================================

function learnPattern(patternsFile: string, pattern: string): void {
	const current = fs.readFileSync(patternsFile, "utf-8");
	const lines = current.trim().split("\n");
	let lastNum = 0;
	for (const line of lines) {
		const m = line.match(/^(\d+)\./);
		if (m) lastNum = Math.max(lastNum, parseInt(m[1]));
	}
	fs.appendFileSync(patternsFile, `${lastNum + 1}. ${pattern}\n`);
}

// =============================================================================
// Activation
// =============================================================================

async function activate(
	monitor: Monitor,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	branch: SessionEntry[],
	steeredThisTurn: Set<string>,
	updateStatus: () => void,
): Promise<void> {
	if (monitor.dismissed) return;

	// check excludes
	for (const ex of monitor.excludes) {
		if (steeredThisTurn.has(ex)) return;
	}

	if (!evaluateWhen(monitor, branch)) return;

	// dedup: skip if user text unchanged since last classification
	const currentUserText = collectUserText(branch);
	if (currentUserText && currentUserText === monitor.lastUserText) return;

	// ceiling check
	if (monitor.whileCount >= monitor.ceiling) {
		await escalate(monitor, pi, ctx);
		updateStatus();
		return;
	}

	const prompt = renderTemplate(monitor, branch);
	if (!prompt) return;

	// create an abort controller so classification can be cancelled if the user aborts
	const abortController = new AbortController();
	const onAbort = () => abortController.abort();
	const unsubAbort = pi.events.on("monitors:abort", onAbort);

	let result: ClassifyResult;
	try {
		result = await classifyPrompt(ctx, monitor, prompt, abortController.signal);
	} catch (e: unknown) {
		if (abortController.signal.aborted) return;
		const message = e instanceof Error ? e.message : String(e);
		if (ctx.hasUI) {
			ctx.ui.notify(`[${monitor.name}] Classification failed: ${message}`, "error");
		} else {
			console.error(`[${monitor.name}] Classification failed: ${message}`);
		}
		return;
	} finally {
		unsubAbort();
	}

	// mark this user text as classified
	monitor.lastUserText = currentUserText;

	if (result.verdict === "clean") {
		monitor.whileCount = 0;
		updateStatus();
		return;
	}

	// learn
	if (result.verdict === "new" && result.newPattern) {
		learnPattern(monitor.patternsFile, result.newPattern);
	}

	// steer
	const description = result.description ?? "Issue detected";
	const annotation = result.verdict === "new" ? " — new pattern learned" : "";
	const details: MonitorMessageDetails = {
		monitorName: monitor.name,
		verdict: result.verdict,
		description,
		steer: monitor.steer,
		whileCount: monitor.whileCount + 1,
		ceiling: monitor.ceiling,
	};
	pi.sendMessage<MonitorMessageDetails>(
		{
			customType: "monitor-steer",
			content: `[${monitor.name}] ${description}${annotation}. ${monitor.steer}`,
			display: true,
			details,
		},
		{ deliverAs: "steer", triggerTurn: true },
	);

	monitor.whileCount++;
	steeredThisTurn.add(monitor.name);
	updateStatus();
}

async function escalate(monitor: Monitor, pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (monitor.escalate === "dismiss") {
		monitor.dismissed = true;
		monitor.whileCount = 0;
		return;
	}

	// ask
	if (ctx.hasUI) {
		const choice = await ctx.ui.confirm(
			`[${monitor.name}] Steered ${monitor.ceiling} times`,
			"Continue steering, or dismiss this monitor for the session?",
		);
		if (!choice) {
			monitor.dismissed = true;
			monitor.whileCount = 0;
			return;
		}
	}
	// if confirmed or no UI, reset and allow one more cycle
	monitor.whileCount = 0;
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
	// seed example monitors on first run if none exist
	const seeded = seedExamples();

	const monitors = discoverMonitors();
	if (monitors.length === 0) return;

	// --- status line ---
	// Cached reference to ctx for status updates from non-event contexts.
	// Set on session_start, used by updateStatus closure.
	let statusCtx: ExtensionContext | undefined;

	function updateStatus(): void {
		if (!statusCtx?.hasUI) return;
		const theme = statusCtx.ui.theme;
		const engaged = monitors.filter((m) => m.whileCount > 0 && !m.dismissed);
		const dismissed = monitors.filter((m) => m.dismissed);

		if (engaged.length === 0 && dismissed.length === 0) {
			const count = theme.fg("dim", `${monitors.length}`);
			statusCtx.ui.setStatus("monitors", `${theme.fg("dim", "monitors:")}${count}`);
			return;
		}

		const parts: string[] = [];
		for (const m of engaged) {
			parts.push(theme.fg("warning", `${m.name}(${m.whileCount}/${m.ceiling})`));
		}
		if (dismissed.length > 0) {
			parts.push(theme.fg("dim", `${dismissed.length} dismissed`));
		}
		statusCtx.ui.setStatus("monitors", `${theme.fg("dim", "monitors:")}${parts.join(" ")}`);
	}

	pi.on("session_start", async (_event, ctx) => {
		statusCtx = ctx;
		if (seeded > 0 && ctx.hasUI) {
			const dir = resolveProjectMonitorsDir();
			ctx.ui.notify(
				`Seeded ${seeded} example monitor files into ${dir}\nEdit or delete them to customize.`,
				"info",
			);
		}
		updateStatus();
	});

	// --- message renderer ---
	pi.registerMessageRenderer<MonitorMessageDetails>("monitor-steer", (message, { expanded }, theme) => {
		const details = message.details;
		if (!details) {
			const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
			box.addChild(new Text(String(message.content), 0, 0));
			return box;
		}

		const verdictColor = details.verdict === "new" ? "warning" : "error";
		const prefix = theme.fg(verdictColor, `[${details.monitorName}]`);
		const desc = ` ${details.description}`;
		const counter = theme.fg("dim", ` (${details.whileCount}/${details.ceiling})`);

		let text = `${prefix}${desc}${counter}`;

		if (details.verdict === "new") {
			text += theme.fg("dim", " — new pattern learned");
		}

		text += `\n${theme.fg("muted", details.steer)}`;

		if (expanded) {
			text += `\n${theme.fg("dim", `verdict: ${details.verdict}`)}`;
		}

		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	// --- abort support ---
	// Cancel in-flight classification calls when the user aborts the agent
	pi.on("agent_end", async () => {
		pi.events.emit("monitors:abort", undefined);
	});

	// --- per-turn exclusion tracking ---
	let steeredThisTurn = new Set<string>();
	pi.on("turn_start", () => { steeredThisTurn = new Set(); });

	// group monitors by validated event
	const byEvent = new Map<MonitorEvent, Monitor[]>();
	for (const m of monitors) {
		const event = m.event as MonitorEvent; // validated in parseMonitorFile
		const list = byEvent.get(event) ?? [];
		list.push(m);
		byEvent.set(event, list);
	}

	// wire event handlers
	for (const [event, group] of byEvent) {
		if (event === "command") {
			for (const m of group) {
				pi.registerCommand(m.name, {
					description: m.description || `Run ${m.name} monitor`,
					handler: async (_args, ctx) => {
						const branch = ctx.sessionManager.getBranch();
						await activate(m, pi, ctx, branch, steeredThisTurn, updateStatus);
					},
				});
			}
		} else if (event === "message_end") {
			pi.on("message_end", async (ev: MessageEndEvent, ctx: ExtensionContext) => {
				if (ev.message.role !== "assistant") return;
				const branch = ctx.sessionManager.getBranch();
				for (const m of group) {
					await activate(m, pi, ctx, branch, steeredThisTurn, updateStatus);
				}
			});
		} else if (event === "turn_end") {
			pi.on("turn_end", async (_ev: TurnEndEvent, ctx: ExtensionContext) => {
				const branch = ctx.sessionManager.getBranch();
				for (const m of group) {
					await activate(m, pi, ctx, branch, steeredThisTurn, updateStatus);
				}
			});
		} else if (event === "agent_end") {
			pi.on("agent_end", async (_ev: AgentEndEvent, ctx: ExtensionContext) => {
				const branch = ctx.sessionManager.getBranch();
				for (const m of group) {
					await activate(m, pi, ctx, branch, steeredThisTurn, updateStatus);
				}
			});
		}
	}

	// /monitors command — list all monitors and their state
	pi.registerCommand("monitors", {
		description: "List active monitors and their state",
		handler: async (_args, ctx) => {
			const lines = monitors.map((m) => {
				const state = m.dismissed
					? "dismissed"
					: m.whileCount > 0
						? `engaged (${m.whileCount}/${m.ceiling})`
						: "idle";
				return `${m.name} [${m.event}${m.when !== "always" ? `, when: ${m.when}` : ""}] — ${state}`;
			});
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// per-monitor /{name} command for show/set instructions
	for (const m of monitors) {
		// skip if the monitor itself is a command (already registered above)
		if (m.event === "command") continue;

		pi.registerCommand(m.name, {
			description: `Direct the ${m.name} monitor`,
			handler: async (args, ctx) => {
				if (!args?.trim()) {
					let patterns = "";
					try { patterns = fs.readFileSync(m.patternsFile, "utf-8"); } catch { patterns = "(missing)"; }
					let instructions = "";
					try { instructions = fs.readFileSync(m.instructionsFile, "utf-8"); } catch { /* optional */ }
					ctx.ui.notify(`[${m.name}]\nInstructions:\n${instructions || "(none)"}\nPatterns:\n${patterns}`, "info");
					return;
				}
				fs.appendFileSync(m.instructionsFile, `- ${args.trim()}\n`);
				ctx.ui.notify(`[${m.name}] Incorporated: ${args.trim()}`, "info");
			},
		});
	}
}
