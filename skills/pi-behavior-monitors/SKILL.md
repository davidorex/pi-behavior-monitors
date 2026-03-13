---
name: pi-behavior-monitors
description: >
  Behavior monitors that watch agent activity and steer corrections when issues are detected.
  Monitors are defined as markdown files in .pi/monitors/ with frontmatter configuration,
  a classification prompt template, a patterns file, and an optional instructions file.
  Use when creating, editing, debugging, or understanding behavior monitors.
---

# Behavior Monitors

Monitors are autonomous watchdogs that observe agent activity, classify it against a
pattern library using a side-channel LLM call, and steer corrections when issues are
detected. Patterns grow over time as new issues are discovered.

## Monitor Locations

Monitors are discovered from:

- Project: `.pi/monitors/*.md` (walks up from cwd to find `.pi/`)
- Global: `~/.pi/agent/monitors/*.md`

Project monitors take precedence over global monitors with the same name.

## File Structure

Each monitor is a triad of files sharing a name prefix:

```
.pi/monitors/
├── fragility.md                 # Monitor definition (frontmatter + prompt template)
├── fragility.patterns.md        # Known patterns (grows automatically)
├── fragility.instructions.md    # User corrections and calibration (optional)
```

## Monitor Definition Format

A monitor `.md` file has YAML frontmatter and a markdown body that serves as the
classification prompt template.

```markdown
---
name: my-monitor
description: What this monitor watches for
event: message_end
when: has_tool_results
model: claude-sonnet-4-20250514
context: [tool_results, assistant_text]
steer: Fix the issue you left behind.
ceiling: 5
escalate: ask
excludes: [other-monitor]
---

Prompt template body with {placeholders} for collected context.

Recent tool outputs:
{tool_results}

The agent said:
"{assistant_text}"

{instructions}

Patterns to check:
{patterns}

Reply CLEAN if no issue.
Reply FLAG:<description> if a known pattern matched.
Reply NEW:<pattern>|<description> if a novel issue was found.
```

### Frontmatter Fields

| Field | Default | Description |
|-------|---------|-------------|
| `name` | (required) | Monitor identifier. Must be unique. |
| `description` | `""` | Human-readable description. |
| `event` | `message_end` | When to fire: `message_end`, `turn_end`, `agent_end`, or `command`. |
| `when` | `always` | Activation condition (see below). |
| `model` | `claude-sonnet-4-20250514` | Model for classification. Supports `provider/model` syntax (e.g., `openai/gpt-4o`). |
| `context` | `[tool_results, assistant_text]` | Which conversation parts to collect (see below). |
| `steer` | `Fix the issue.` | Instruction sent to the agent when an issue is detected. |
| `ceiling` | `5` | Max consecutive steers before escalation. |
| `escalate` | `ask` | What to do at ceiling: `ask` (confirm with user) or `dismiss` (silence for session). |
| `excludes` | `[]` | Monitor names to skip if they already steered this turn. |

### When Conditions

- `always` — fire every time the event occurs
- `has_tool_results` — fire only if tool results are present in the current turn
- `has_file_writes` — fire only if `write` or `edit` was called
- `has_bash` — fire only if `bash` was called
- `tool(name)` — fire only if a specific tool was called (e.g., `tool(bash)`)
- `every(N)` — fire every Nth activation within the same user prompt

### Context Collectors

The `context` array controls which conversation parts are collected and made available
as template placeholders:

| Collector | Placeholder | What it collects |
|-----------|-------------|------------------|
| `user_text` | `{user_text}` | The most recent user message text |
| `assistant_text` | `{assistant_text}` | The most recent assistant message text |
| `tool_results` | `{tool_results}` | Last 5 tool results with tool name and error status |
| `tool_calls` | `{tool_calls}` | Last 20 tool calls and results |
| `custom_messages` | `{custom_messages}` | Custom extension messages since last user message |

### Built-in Placeholders

These are always available regardless of the `context` array:

- `{patterns}` — contents of the `.patterns.md` file
- `{instructions}` — contents of the `.instructions.md` file (wrapped with a preamble)
- `{iteration}` — current consecutive steer count

## Verdict Format

The classification LLM must respond with one of:

- `CLEAN` — no issue detected. Resets the consecutive steer counter.
- `FLAG:<description>` — a known pattern matched. Triggers steering.
- `NEW:<pattern>|<description>` — a novel issue not in the pattern library. The pattern
  is automatically appended to the `.patterns.md` file, then steering is triggered.

## Patterns File

The `.patterns.md` file is a numbered list of known issues:

```markdown
# Fragility Patterns

1. Dismissing errors as pre-existing instead of fixing them
2. Adding TODO comments instead of solving the problem now
3. Returning early when an unexpected condition is hit instead of handling it
```

This file grows automatically when `NEW:` verdicts are returned. You can also edit it
manually to add, remove, or refine patterns.

## Instructions File

The `.instructions.md` file contains user corrections that calibrate the monitor —
reducing false positives or catching missed issues:

```markdown
# Operating Instructions

- grep returning exit code 1 means zero matches, not a failure
- catch-and-log in event handlers is correct for non-critical extensions
```

Add instructions via the slash command: `/<monitor-name> <instruction>`

For example: `/fragility grep exit code 1 is not an error`

This appends `- grep exit code 1 is not an error` to the instructions file.

## Commands

| Command | Description |
|---------|-------------|
| `/monitors` | List all monitors and their current state (idle, engaged, dismissed) |
| `/<name>` | Show the monitor's current patterns and instructions |
| `/<name> <text>` | Append an instruction to the monitor's instructions file |

For monitors with `event: command`, the `/<name>` command runs the monitor on demand
instead of showing its state.

## Event-Driven vs On-Demand Monitors

Most monitors fire automatically on agent events (`message_end`, `turn_end`, `agent_end`).
Setting `event: command` creates an on-demand monitor that only runs when the user
explicitly invokes `/<name>`.

## Escalation

When a monitor steers the agent `ceiling` times consecutively without a `CLEAN` result:

- `escalate: ask` — prompts the user to continue or dismiss the monitor for the session
- `escalate: dismiss` — silently dismisses the monitor for the rest of the session

A `CLEAN` verdict resets the counter.

## Example: Creating a New Monitor

1. Create the definition file `.pi/monitors/naming.md`:

```markdown
---
name: naming
description: Detects poor naming choices in code changes
event: turn_end
when: has_file_writes
model: claude-sonnet-4-20250514
context: [tool_calls]
steer: Rename the poorly named identifier.
ceiling: 3
escalate: ask
---

An agent made code changes. Check if any new identifiers have poor names.

Actions taken:
{tool_calls}

{instructions}

Naming patterns to check:
{patterns}

Reply CLEAN if all names are clear and descriptive.
Reply FLAG:<description> if a known naming pattern was matched.
Reply NEW:<pattern>|<description> if a naming issue not covered by existing patterns.
```

2. Create the patterns file `.pi/monitors/naming.patterns.md`:

```markdown
# Naming Patterns

1. Single-letter variable names outside of loop counters
2. Generic names like data, info, result, value, temp without context
3. Boolean variables not phrased as questions (is, has, can, should)
```

3. Create an empty instructions file `.pi/monitors/naming.instructions.md`:

```markdown
# Operating Instructions

```

The monitor will start running on the next session.
