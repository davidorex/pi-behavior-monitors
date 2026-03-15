---
name: pi-behavior-monitors
description: >
  Behavior monitors that watch agent activity and steer corrections when issues are detected.
  Monitors are JSON files (.monitor.json) in .pi/monitors/ with classify, patterns, actions,
  and scope blocks. Patterns and instructions are JSON arrays. Use when creating, editing,
  debugging, or understanding behavior monitors.
---

<objective>
Monitors are autonomous watchdogs that observe agent activity, classify it against a
JSON pattern library using a side-channel LLM call, and either steer corrections or
write structured findings to JSON files for downstream consumption.
</objective>

<monitor_locations>
Monitors are discovered from:

- Project: `.pi/monitors/*.monitor.json` (walks up from cwd to find `.pi/`)
- Global: `~/.pi/agent/monitors/*.monitor.json`

Project monitors take precedence over global monitors with the same name.
</monitor_locations>

<file_structure>
Each monitor is a triad of JSON files sharing a name prefix:

```
.pi/monitors/
├── fragility.monitor.json       # Monitor definition (classify + patterns + actions + scope)
├── fragility.patterns.json      # Known patterns (JSON array, grows automatically)
├── fragility.instructions.json  # User corrections (JSON array, optional)
```
</file_structure>

<monitor_definition>
A `.monitor.json` file conforms to `schemas/monitor.schema.json`:

```json
{
  "name": "my-monitor",
  "description": "What this monitor watches for",
  "event": "message_end",
  "when": "has_tool_results",
  "scope": {
    "target": "main",
    "filter": { "agent_type": ["audit-fixer"] }
  },
  "classify": {
    "model": "claude-sonnet-4-20250514",
    "context": ["tool_results", "assistant_text"],
    "excludes": ["other-monitor"],
    "prompt": "Classification prompt with {tool_results} {assistant_text} {patterns} {instructions} placeholders.\n\nReply CLEAN, FLAG:<desc>, or NEW:<pattern>|<desc>."
  },
  "patterns": {
    "path": "my-monitor.patterns.json",
    "learn": true
  },
  "instructions": {
    "path": "my-monitor.instructions.json"
  },
  "actions": {
    "on_flag": {
      "steer": "Fix the issue.",
      "write": {
        "path": ".workflow/gaps.json",
        "merge": "append",
        "array_field": "gaps",
        "template": {
          "id": "monitor-{finding_id}",
          "description": "{description}",
          "status": "open",
          "category": "monitor",
          "source": "monitor"
        }
      }
    },
    "on_new": {
      "steer": "Fix the issue.",
      "learn_pattern": true,
      "write": { "...": "same as on_flag" }
    },
    "on_clean": null
  },
  "ceiling": 5,
  "escalate": "ask"
}
```
</monitor_definition>

<fields>

**Top-level fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `name` | (required) | Monitor identifier. Must be unique. |
| `description` | `""` | Human-readable description. |
| `event` | `message_end` | When to fire: `message_end`, `turn_end`, `agent_end`, or `command`. |
| `when` | `always` | Activation condition (see below). |
| `ceiling` | `5` | Max consecutive steers before escalation. |
| `escalate` | `ask` | At ceiling: `ask` (confirm with user) or `dismiss` (silence for session). |

**Scope block:**

| Field | Default | Description |
|-------|---------|-------------|
| `scope.target` | `main` | What to observe: `main`, `subagent`, `all`, `workflow`. |
| `scope.filter.agent_type` | — | Only monitor agents with these names. |
| `scope.filter.step_name` | — | Glob pattern for workflow step names. |
| `scope.filter.workflow` | — | Glob pattern for workflow names. |

Steering only fires for `main` scope. Non-main scopes write to JSON only.

**Classify block:**

| Field | Default | Description |
|-------|---------|-------------|
| `classify.model` | `claude-sonnet-4-20250514` | Model for classification. Supports `provider/model`. |
| `classify.context` | `[tool_results, assistant_text]` | Conversation parts to collect. |
| `classify.excludes` | `[]` | Monitor names to skip if they already steered this turn. |
| `classify.prompt` | (required) | Classification prompt template with `{placeholders}`. |

**Actions block** — per verdict (`on_flag`, `on_new`, `on_clean`):

| Field | Description |
|-------|-------------|
| `steer` | Message to inject into conversation. `null` = no steering. |
| `write.path` | JSON file to write findings to. |
| `write.merge` | `append` (add to array) or `upsert` (update by id). |
| `write.array_field` | Which field in target JSON holds the array. |
| `write.template` | Template mapping with `{finding_id}`, `{description}`, `{severity}`, `{monitor_name}`, `{timestamp}`. |
| `learn_pattern` | If true, add new pattern to patterns file on `new` verdict. |
</fields>

<when_conditions>
- `always` — fire every time the event occurs
- `has_tool_results` — fire only if tool results are present
- `has_file_writes` — fire only if `write` or `edit` was called
- `has_bash` — fire only if `bash` was called
- `tool(name)` — fire only if a specific tool was called
- `every(N)` — fire every Nth activation within the same user prompt
</when_conditions>

<context_collectors>
| Collector | Placeholder | What it collects |
|-----------|-------------|------------------|
| `user_text` | `{user_text}` | Most recent user message text |
| `assistant_text` | `{assistant_text}` | Most recent assistant message text |
| `tool_results` | `{tool_results}` | Last 5 tool results with tool name and error status |
| `tool_calls` | `{tool_calls}` | Last 20 tool calls and results |
| `custom_messages` | `{custom_messages}` | Custom extension messages since last user message |

Built-in placeholders (always available):
- `{patterns}` — formatted from patterns JSON (numbered list with severity)
- `{instructions}` — formatted from instructions JSON (bulleted list with preamble)
- `{iteration}` — current consecutive steer count
</context_collectors>

<patterns_file>
JSON array conforming to `schemas/monitor-pattern.schema.json`:

```json
[
  {
    "id": "empty-catch",
    "description": "Silently catching exceptions with empty catch blocks",
    "severity": "error",
    "category": "error-handling",
    "source": "bundled"
  },
  {
    "id": "learned-pattern-abc",
    "description": "Learned pattern from runtime detection",
    "severity": "warning",
    "source": "learned",
    "learned_at": "2026-03-15T02:30:00.000Z"
  }
]
```

Patterns grow automatically when `learn_pattern: true` and a `NEW:` verdict is returned.
</patterns_file>

<instructions_file>
JSON array of user corrections:

```json
[
  { "text": "grep exit code 1 is not an error", "added_at": "2026-03-15T02:30:00.000Z" },
  { "text": "catch-and-log in event handlers is correct for non-critical extensions", "added_at": "2026-03-15T03:00:00.000Z" }
]
```

Add via slash command: `/<monitor-name> <instruction>`
</instructions_file>

<verdict_format>
The classification LLM must respond with one of:

- `CLEAN` — no issue detected. Resets consecutive steer counter.
- `FLAG:<description>` — known pattern matched. Triggers action.
- `NEW:<pattern>|<description>` — novel issue. Pattern learned if `learn_pattern: true`, then triggers action.
</verdict_format>

<commands>
| Command | Description |
|---------|-------------|
| `/monitors` | List all monitors, their scope, and state (idle/engaged/dismissed) |
| `/<name>` | Show monitor's patterns and instructions |
| `/<name> <text>` | Add instruction to calibrate the monitor |

For `event: command` monitors, `/<name>` runs the monitor on demand.
</commands>

<example_creating>
1. Create `.pi/monitors/naming.monitor.json`:

```json
{
  "name": "naming",
  "description": "Detects poor naming choices in code changes",
  "event": "turn_end",
  "when": "has_file_writes",
  "scope": { "target": "main" },
  "classify": {
    "model": "claude-sonnet-4-20250514",
    "context": ["tool_calls"],
    "excludes": [],
    "prompt": "An agent made code changes. Check if any new identifiers have poor names.\n\nActions taken:\n{tool_calls}\n\n{instructions}\n\nNaming patterns to check:\n{patterns}\n\nReply CLEAN if all names are clear.\nReply FLAG:<description> if a known naming pattern matched.\nReply NEW:<pattern>|<description> if a naming issue not covered by existing patterns."
  },
  "patterns": { "path": "naming.patterns.json", "learn": true },
  "instructions": { "path": "naming.instructions.json" },
  "actions": {
    "on_flag": { "steer": "Rename the poorly named identifier." },
    "on_new": { "steer": "Rename the poorly named identifier.", "learn_pattern": true },
    "on_clean": null
  },
  "ceiling": 3,
  "escalate": "ask"
}
```

2. Create `.pi/monitors/naming.patterns.json`:

```json
[
  { "id": "single-letter", "description": "Single-letter variable names outside of loop counters", "severity": "warning", "source": "bundled" },
  { "id": "generic-names", "description": "Generic names like data, info, result, value, temp without context", "severity": "warning", "source": "bundled" },
  { "id": "bool-not-question", "description": "Boolean variables not phrased as questions (is, has, can, should)", "severity": "info", "source": "bundled" }
]
```

3. Create `.pi/monitors/naming.instructions.json`:

```json
[]
```
</example_creating>

<success_criteria>
- Monitor `.monitor.json` validates against `schemas/monitor.schema.json`
- Patterns `.patterns.json` validates against `schemas/monitor-pattern.schema.json`
- Classification prompt includes `{patterns}` and verdict format instructions
- Actions specify both `steer` (for main scope) and `write` (for JSON output) where appropriate
- Scope correctly targets main vs subagent vs workflow observations
</success_criteria>
