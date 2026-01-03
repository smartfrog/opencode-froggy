# opencode-froggy

An OpenCode plugin that provides custom agents, commands, skills, and automatic code simplification on session idle.

## Features

### Agents

| Agent | Mode | Description |
|-------|------|-------------|
| `code-reviewer` | subagent | Reviews code for quality, correctness, and security. Read-only with restricted git access. |
| `code-simplifier` | subagent | Simplifies recently modified code for clarity and maintainability while strictly preserving behavior. |
| `doc-writer` | subagent | Technical writer that crafts clear, comprehensive documentation (README, API docs, architecture docs, user guides). |

### Commands

| Command | Description | Agent |
|---------|-------------|-------|
| `/commit` | Create a commit with appropriate message, create branch if on main/master, and push | `build` |
| `/review-changes` | Review uncommitted changes (staged + unstaged, including untracked files) | `code-reviewer` |
| `/review-pr <source> <target>` | Review changes from source branch into target branch | `code-reviewer` |
| `/simplify-changes` | Simplify uncommitted changes (staged + unstaged, including untracked files) | `code-simplifier` |
| `/tests-coverage` | Run the full test suite with coverage report and suggest fixes for failures | `build` |

### Skills

| Skill | Description |
|-------|-------------|
| `post-change-code-simplification` | Enforce systematic code simplification after any code modification using git-diff-based scope |

### Hooks

Hooks run actions on session events. Configuration lives in `hook/hooks.md`.

#### Configuration file

- YAML frontmatter must include a `hooks` list.
- Each hook defines `event`, `actions`, and optional `conditions`.
- Hooks for the same event run in declaration order.

Minimal schema:

```markdown
# hook/hooks.md
---
hooks:
  - event: session.idle
    conditions: [hasCodeChange, isMainSession]
    actions:
      - command: simplify-changes
---
```

#### Supported events

| Event | Description |
|-------|-------------|
| `session.idle` | Emitted when a session becomes idle and has files modified via `write` or `edit` in that session |
| `session.created` | Emitted when a session is created |
| `session.deleted` | Emitted when a session is deleted |
| `tool.after.write` | Accepted in config but not emitted by this plugin |
| `tool.after.edit` | Accepted in config but not emitted by this plugin |

#### Conditions

| Condition | Description |
|-----------|-------------|
| `isMainSession` | Run only for the main session (not sub-sessions) |
| `hasCodeChange` | Run only if at least one modified file looks like code |

All listed conditions must pass for the hook to run.

Code extensions treated as "code" by default:
`ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `json`, `yml`, `yaml`, `toml`, `css`, `scss`, `sass`, `less`, `html`, `vue`, `svelte`, `go`, `rs`, `c`, `h`, `cpp`, `cc`, `cxx`, `hpp`, `java`, `py`, `rb`, `php`, `sh`, `bash`, `kt`, `kts`, `swift`, `m`, `mm`, `cs`, `fs`, `scala`, `clj`, `hs`, `lua`.

#### Supported actions

- **Command**
  - Short form: `command: simplify-changes`
  - With args:
    - `command:`
      - `name: review-pr`
      - `args: "main feature"`
  - If the command exists in config, the plugin reuses its `agent` and `model`.
- **Skill**
  - `skill: post-change-code-simplification`
  - The plugin prompts the session to use the `skill` tool.
- **Tool**
  - `tool:`
    - `name: bash`
    - `args: { command: "echo done" }`
  - The plugin prompts the session to use the tool with these arguments.

#### Execution behavior

- Action errors are logged and do not stop later actions.
- `session.idle` only fires if files were modified via `write` or `edit`; the session's modified file list is cleared after the hook runs.
- The main session is set on `session.created` with no parent, or on the first `session.idle` if needed.

Example:

```markdown
# hook/hooks.md
---
hooks:
  - event: session.idle
    conditions: [hasCodeChange, isMainSession]
    actions:
      - command: simplify-changes

  - event: session.created
    actions:
      - skill: post-change-code-simplification
      - command:
          name: review-pr
          args: "main feature"
      - tool:
          name: bash
          args:
            command: "echo done"
---
```

## Installation

Add the plugin to your OpenCode configuration file at `~/.config/opencode/opencode.json`:

```json
{
  "plugin": {
    "froggy": {
      "path": "/path/to/opencode-froggy"
    }
  }
}
```

Or if published to npm:

```json
{
  "plugin": {
    "froggy": {
      "module": "opencode-froggy"
    }
  }
}
```

## Usage

### Review uncommitted changes

```
/review-changes
```

Reviews all staged, unstaged, and untracked changes in the working tree.

### Review a pull request

```
/review-pr feature-branch main
```

Fetches and reviews changes from `origin/feature-branch` into `origin/main`.

### Simplify uncommitted changes

```
/simplify-changes
```

Analyzes and simplifies all uncommitted changes while preserving behavior.

### Commit and push

```
/commit
```

Creates a branch (if on main/master), commits with an appropriate message, and pushes.

### Run tests with coverage

```
/tests-coverage
```

Runs the test suite with coverage and suggests fixes for failures.

### Load a skill manually

Use the `skill` tool to load skill instructions:

```
skill({ name: "post-change-code-simplification" })
```

## Configuration Options

The plugin does not require additional configuration. All agents, commands, skills, and hooks are loaded automatically from the `agent/`, `command/`, `skill/`, and `hook/` directories.

### Supported Code File Extensions

The `hasCodeChange` condition checks file extensions against the default set listed in the Hooks section. Hooks without any conditions still trigger on any modified file paths tracked via `write` or `edit` in the current session.

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

### Type checking

```bash
npm run typecheck
```

## License

MIT
