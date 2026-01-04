# opencode-froggy

## Overview

opencode-froggy is an OpenCode plugin that adds agents, commands, skills, and a hook system.
It can automatically simplify changes when the session becomes idle, if files were modified
via `write` or `edit`. Hooks are loaded from OpenCode configuration directories (global and project-level).

## Features

### Agents

| Agent | Mode | Description |
|-------|------|-------------|
| `architect` | subagent | Strategic technical advisor providing high-leverage guidance on architecture, code structure, and complex engineering trade-offs. Read-only. |
| `code-reviewer` | subagent | Reviews code for quality, correctness, and security. Read-only with restricted git access. |
| `code-simplifier` | subagent | Simplifies recently modified code for clarity and maintainability while strictly preserving behavior. |
| `doc-writer` | subagent | Technical writer that crafts clear, comprehensive documentation (README, API docs, architecture docs, user guides). |
| `partner` | subagent | Strategic ideation partner that breaks frames, expands solution spaces, and surfaces non-obvious strategic options. Read-only. |

### Commands

| Command | Description | Agent |
|---------|-------------|-------|
| `/commit` | Create a commit with appropriate message, create branch if on main/master, and push | `build` |
| `/review-changes` | Review uncommitted changes (staged + unstaged, including untracked files) | `code-reviewer` |
| `/review-pr <source> <target>` | Review changes from source branch into target branch | `code-reviewer` |
| `/simplify-changes` | Simplify uncommitted changes (staged + unstaged, including untracked files) | `code-simplifier` |
| `/tests-coverage` | Run the full test suite with coverage report and suggest fixes for failures | `build` |

### Hooks

Hooks run actions on session events. Configuration is loaded from standard OpenCode configuration directories.

#### Configuration locations

Hooks are loaded from these locations (in order, merged together):

| Platform | Global | Project |
|----------|--------|---------|
| Linux | `~/.config/opencode/hook/hooks.md` | `<project>/.opencode/hook/hooks.md` |
| macOS | `~/.config/opencode/hook/hooks.md` | `<project>/.opencode/hook/hooks.md` |
| Windows | `~/.config/opencode/hook/hooks.md` or `%APPDATA%/opencode/hook/hooks.md` | `<project>/.opencode/hook/hooks.md` |

On Windows, `~/.config` is preferred for cross-platform consistency. If hooks exist in `%APPDATA%` but not in `~/.config`, the `%APPDATA%` location is used.

Global hooks run first, then project hooks are added. Hooks from both sources are combined (not overridden).

#### Configuration file

- YAML frontmatter must include a `hooks` list.
- Each hook defines `event`, `actions`, and optional `conditions`.
- Hooks for the same event run in declaration order.

Example `hooks.md`:

```markdown
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
| `tool.before.*` | Emitted before any tool executes. Exit code 2 blocks the tool. |
| `tool.before.<name>` | Emitted before a specific tool (e.g., `tool.before.write`). Exit code 2 blocks the tool. |
| `tool.after.*` | Emitted after any tool executes |
| `tool.after.<name>` | Emitted after a specific tool (e.g., `tool.after.edit`) |

**Tool hook execution order:**
1. `tool.before.*` (all tools)
2. `tool.before.<name>` (specific tool)
3. *(tool executes)*
4. `tool.after.*` (all tools)
5. `tool.after.<name>` (specific tool)

**Blocking tools with exit code 2:**
For `tool.before.*` and `tool.before.<name>` hooks, a bash action returning exit code 2 will block the tool from executing. The stderr output is displayed to the user as the block reason.

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
- **Tool**
  - `tool:`
    - `name: bash`
    - `args: { command: "echo done" }`
  - The plugin prompts the session to use the tool with these arguments.
- **Bash**
  Executes a shell command directly without involving the LLM. Useful for running linters, formatters, build scripts, or custom automation.

  **Configuration:**
  ```yaml
  # Short form
  - bash: "npm run lint"

  # Long form with custom timeout
  - bash:
      command: "$OPENCODE_PROJECT_DIR/.opencode/hooks/init.sh"
      timeout: 30000  # milliseconds (default: 60000)
  ```

  **Environment variables:**

  The plugin injects these variables into the child process environment before executing the command:

  | Variable | Value | Use case |
  |----------|-------|----------|
  | `OPENCODE_PROJECT_DIR` | Absolute path to the project (e.g., `/home/user/project`) | Reference project files from scripts located elsewhere |
  | `OPENCODE_SESSION_ID` | The OpenCode session identifier | Logging, tracing, or conditioning actions based on session |

  Example usage in a script:
  ```bash
  #!/bin/bash
  # Access variables directly
  echo "Project: $OPENCODE_PROJECT_DIR"
  echo "Session: $OPENCODE_SESSION_ID"

  # Access a project file
  cat "$OPENCODE_PROJECT_DIR/package.json"

  # Log with session ID
  echo "[$OPENCODE_SESSION_ID] Hook executed" >> /tmp/opencode.log
  ```

  **Stdin JSON context:**
  The command receives a JSON object via stdin with session context:
  ```json
  {
    "session_id": "abc123",
    "event": "session.idle",
    "cwd": "/path/to/project",
    "files": ["src/index.ts", "src/utils.ts"]
  }
  ```
  The `files` array is only present for `session.idle` events and contains paths modified via `write` or `edit`.

  For tool hooks (`tool.before.*`, `tool.after.*`), additional fields are provided:
  ```json
  {
    "session_id": "abc123",
    "event": "tool.before.write",
    "cwd": "/path/to/project",
    "tool_name": "write",
    "tool_args": { "filePath": "src/index.ts", "content": "..." }
  }
  ```

  **Environment variables vs stdin JSON:**
  - **Environment variables**: Direct access via `$VAR`, convenient for simple values like paths and IDs
  - **Stdin JSON**: Contains richer context (event type, working directory, modified files), requires parsing with `jq` or similar

  Both mechanisms are complementary. Use environment variables for quick access to project path and session ID; use stdin JSON when you need event details or the list of modified files.

  **Exit codes:**
  | Code | Behavior |
  |------|----------|
  | `0` | Success, continue to next action |
  | `2` | Blocking error, stop remaining actions in this hook |
  | Other | Non-blocking error, log warning and continue |

  **Result feedback:**
  Bash hook results are automatically sent back to your session, so you can see what happened:
  ```
  [BASH HOOK ✓] npm run lint
  Exit: 0 | Duration: 1234ms
  Stdout: All files passed linting
  ```
  The feedback includes a status icon (✓ success, ✗ failure), exit code, execution duration, and stdout/stderr output (truncated to 500 characters). This message appears in your session but does not trigger a response from the assistant.

#### Execution behavior

- Action errors are logged and do not stop later actions.
- `session.idle` only fires if files were modified via `write` or `edit`; the session's modified file list is cleared after the hook runs.
- The main session is set on `session.created` with no parent, or on the first `session.idle` if needed.

Example with multiple hooks:

```markdown
---
hooks:
  - event: session.idle
    conditions: [hasCodeChange, isMainSession]
    actions:
      - bash: "npm run lint --fix"
      - command: simplify-changes

  - event: session.created
    actions:
      - bash:
          command: "$OPENCODE_PROJECT_DIR/.opencode/hooks/init.sh"
          timeout: 30000
      - command:
          name: review-pr
          args: "main feature"
---
```

#### Example bash hook scripts

**Simple lint-on-idle hook:**
```yaml
hooks:
  - event: session.idle
    conditions: [hasCodeChange]
    actions:
      - bash: "npm run lint --fix"
```

**Custom initialization script (`.opencode/hooks/init.sh`):**
```bash
#!/bin/bash
set -e

# Read JSON context from stdin
context=$(cat)
session_id=$(echo "$context" | jq -r '.session_id')
event=$(echo "$context" | jq -r '.event')
cwd=$(echo "$context" | jq -r '.cwd')

echo "Session $session_id triggered $event in $cwd"

# Use environment variables
echo "Project: $OPENCODE_PROJECT_DIR"

# Exit 0 for success, 2 to block remaining actions
exit 0
```

**Conditional blocking based on lint errors:**
```bash
#!/bin/bash
# Run linter and block if critical errors found
if ! npm run lint 2>&1 | grep -q "critical"; then
  exit 0  # Success, continue
else
  echo "Critical lint errors found, blocking further actions"
  exit 2  # Block remaining actions
fi
```

#### Example tool hooks

**Block modifications to sensitive files:**
```yaml
hooks:
  - event: tool.before.write
    actions:
      - bash: |
          file=$(cat | jq -r '.tool_args.filePath // .tool_args.file_path // .tool_args.path')
          if echo "$file" | grep -qE '\.(env|pem|key)$'; then
            echo "Cannot modify sensitive files: $file" >&2
            exit 2
          fi

  - event: tool.before.edit
    actions:
      - bash: |
          file=$(cat | jq -r '.tool_args.filePath // .tool_args.file_path // .tool_args.path')
          if echo "$file" | grep -qE '\.(env|pem|key)$'; then
            echo "Cannot modify sensitive files: $file" >&2
            exit 2
          fi
```

**Auto-format TypeScript files after write:**
```yaml
hooks:
  - event: tool.after.write
    actions:
      - bash: |
          file=$(cat | jq -r '.tool_args.filePath // .tool_args.file_path // .tool_args.path')
          if echo "$file" | grep -qE '\.tsx?$'; then
            npx prettier --write "$file"
          fi
```

**Log all tool executions:**
```yaml
hooks:
  - event: tool.before.*
    actions:
      - bash: |
          context=$(cat)
          tool=$(echo "$context" | jq -r '.tool_name')
          echo "[$(date)] Tool: $tool" >> /tmp/opencode-tools.log
```

## Installation

Add the plugin to your OpenCode configuration file at `~/.config/opencode/opencode.json`:

```json
{
  "plugin": {
    "froggy": {
      "module": "opencode-froggy"
    }
  }
}
```

Or from source (for development):

```json
{
  "plugin": {
    "froggy": {
      "path": "/path/to/opencode-froggy"
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

## Configuration Options

The plugin does not require additional configuration. Agents, commands, and skills are loaded automatically from the `agent/`, `command/`, and `skill/` directories within the plugin. Hooks are loaded from the standard OpenCode configuration directories (see Hooks section above).

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
