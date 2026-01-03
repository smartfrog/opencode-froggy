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

Hooks allow you to configure actions to execute on specific events. All hooks are defined in a single file `hook/hooks.md`.

#### Supported Events

| Event | Description |
|-------|-------------|
| `session.idle` | Triggered when the main session becomes idle with modified files |
| `session.created` | Triggered when a new session is created |
| `session.deleted` | Triggered when a session is deleted |
| `tool.after.write` | Triggered after a file write operation |
| `tool.after.edit` | Triggered after a file edit operation |

#### Hook File Format

```markdown
# hook/hooks.md
---
hooks:
  - event: session.idle
    condition: isMainSession  # Optional: only "isMainSession" supported for now
    actions:
      - command: simplify-changes           # Execute a command

  - event: session.created
    actions:
      - skill: post-change-code-simplification  # Load and execute a skill
      - command:                            # Command with arguments
          name: review-pr
          args: "main feature"
      - tool:                               # Execute a tool directly
          name: bash
          args:
            command: "echo done"
---
```

#### Default Hook

The plugin ships with a default `session.idle` hook that triggers code simplification:

```markdown
# hook/hooks.md
---
hooks:
  - event: session.idle
    condition: isMainSession
    actions:
      - command: simplify-changes
---
```

#### Conditions

| Condition | Description |
|-----------|-------------|
| `isMainSession` | Only execute if triggered on the main session (not subagent sessions) |

Multiple hooks can be defined for the same event with different conditions. They execute in declaration order.

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

The auto-simplification feature tracks files with these extensions:

- JavaScript/TypeScript: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
- Python: `.py`
- Go: `.go`
- Rust: `.rs`
- Ruby: `.rb`
- Java/Kotlin/Scala: `.java`, `.kt`, `.scala`
- C/C++: `.c`, `.cpp`, `.h`, `.hpp`
- C#: `.cs`
- Swift: `.swift`
- PHP: `.php`
- Web: `.vue`, `.svelte`, `.astro`
- Shell: `.sh`, `.bash`, `.zsh`, `.fish`
- Data/Config: `.sql`, `.graphql`, `.prisma`, `.yaml`, `.yml`, `.toml`

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
