# pi-behavior-monitors

Behavior monitors for [pi](https://github.com/badlogic/pi-mono) that watch agent activity and steer corrections when issues are detected.

Monitors are defined as markdown files with a classification prompt template and a growing pattern library. When the LLM agent does something that matches a known pattern (or a novel issue is detected), the monitor steers the agent to fix it. New patterns are learned automatically.

## Install

```bash
pi install npm:pi-behavior-monitors
```

On first run, if no monitors exist in your project, example monitors are seeded into `.pi/monitors/`. Edit or delete them to customize.

## Bundled Example Monitors

- **fragility** — detects when the agent leaves broken state behind (errors it noticed but didn't fix, TODO comments instead of solutions, empty catch blocks)
- **hedge** — detects when the agent deviates from what the user actually said (rephrasing questions, assuming intent, deflecting with counter-questions)
- **work-quality** — on-demand audit of work quality (trial-and-error, not reading before editing, fixing symptoms instead of root causes). Invoked via `/work-quality`.

## Writing Your Own

Create a markdown file in `.pi/monitors/` with YAML frontmatter and a classification prompt template. Each monitor needs three files:

```
.pi/monitors/
├── my-monitor.md                # Definition (frontmatter + prompt)
├── my-monitor.patterns.md       # Known patterns (grows automatically)
└── my-monitor.instructions.md   # User corrections (optional)
```

Ask the LLM to read the `pi-behavior-monitors` skill for the full schema and examples.

## Commands

| Command | Description |
|---------|-------------|
| `/monitors` | List all monitors and their current state |
| `/<name>` | Show monitor patterns and instructions |
| `/<name> <text>` | Add an instruction to calibrate the monitor |

## How It Works

1. A monitor fires on a configured event (e.g., after each assistant message)
2. It collects relevant conversation context (tool results, assistant text, etc.)
3. A side-channel LLM call classifies the context against the pattern library
4. If an issue is found, the agent is steered to fix it
5. Novel issues are learned and added to the pattern library automatically
