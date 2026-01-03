# AGENTS.md

This repository is an OpenCode plugin written in TypeScript. The guidance below
is for agentic coding tools that will modify or run code here.

## Scope and structure

- Source code lives in `src/`.
- Tests live alongside sources in `src/**/*.test.ts`.
- Build output goes to `dist/`.
- Hooks configuration lives in `hook/hooks.md` (YAML frontmatter).
- Agents, commands, and skills are loaded from `agent/`, `command/`, and `skill/`.
- Skills are discovered by `skill/<name>/SKILL.md`.

## Setup

- Requires Node.js 18+.
- Install dependencies with:
  - `npm install`

## Build, typecheck, lint, test

There is no dedicated lint script or ESLint config. Use typecheck as the
closest linting step.

- Build:
  - `npm run build`
- Typecheck (strict):
  - `npm run typecheck`
- Tests (all):
  - `npm test`
- Test watch (local dev):
  - `npx vitest`

### Run a single test file

Vitest is configured via `vitest.config.ts` and runs `src/**/*.test.ts`.

Use any of the following:
- `npm test -- src/index.test.ts`
- `npx vitest run src/index.test.ts`

### Run a single test by name

- `npm test -- -t "should parse valid frontmatter"`
- `npx vitest run -t "should parse valid frontmatter"`

### Run a single test file and name

- `npx vitest run src/index.test.ts -t "should parse valid frontmatter"`

### Optional quick checks

- Typecheck only:
  - `npm run typecheck`
- Build only:
  - `npm run build`

## Code style and conventions

### TypeScript

- Use TypeScript (ES module syntax) and keep `strict` type safety.
- Avoid `any`. Prefer explicit types or narrow types with guards.
- Prefer `unknown` for untrusted data, then validate or narrow.
- Prefer `Record<string, unknown>` over loose object types.
- Use `type`-only imports for types (`import { type Foo } ...`).

### Imports

- Use Node.js ESM imports, with `node:` specifiers for core modules:
  - `import { join } from "node:path"`
- Prefer named imports; avoid default imports when not required.
- Keep imports grouped and ordered:
  1. Node core modules
  2. External dependencies
  3. Local modules

### Formatting

- Use 2-space indentation.
- Use double quotes for strings.
- No semicolons in existing code; follow that style.
- Keep lines readable; wrap long objects onto multiple lines.
- Align object literals and multiline logs for readability.

### Naming

- Functions and variables: `camelCase`.
- Types and interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants.
- Filenames: `kebab-case` or existing file names (do not rename casually).
- Hook events and conditions use `snake.case` style strings.

### Error handling and logging

- Prefer explicit error handling with `try/catch` around filesystem I/O.
- If an operation is non-critical, log and continue instead of throwing.
- Use the local logger in `src/logger.ts` for plugin-related logging.
- Keep error messages concise and include minimal context as JSON when useful.
- When swallowing errors, do so intentionally (as in `log()`).

### Control flow and side effects

- Keep functions small and focused; avoid deep nesting.
- Avoid mutating inputs; create new objects when transforming data.
- When iterating, prefer `for...of` where `await` is used.
- Keep hook execution order deterministic (iterate in declaration order).

### Plugin behavior conventions

- Hooks are declared in `hook/hooks.md` frontmatter.
- When adding new hook events, update `VALID_HOOK_EVENTS` and docs.
- Action errors should not stop later actions.
- Do not change session lifecycle behavior without updating tests.
- Tool hooks track files modified by `write` and `edit` tools.

### Data parsing

- Frontmatter parsing is tolerant: invalid YAML yields empty data.
- Treat loader outputs as best-effort (missing dirs return empty results).
- Keep YAML parsing behavior compatible with `js-yaml`.

### Tests

- Use Vitest and global `describe/it/expect`.
- Tests should be deterministic and avoid network access.
- For filesystem tests, use temp directories via `os.tmpdir()` and clean up.
- Prefer explicit assertions over snapshots.

## Documentation expectations

- Keep README and hook docs consistent with implementation.
- If you change supported events or actions, update `README.md` accordingly.
- Update `hook/hooks.md` frontmatter examples if behavior changes.

## Cursor and Copilot rules

- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- No Copilot instructions found in `.github/copilot-instructions.md`.

## Working agreement for agents

- Be surgical: change only what is required for the task.
- Preserve existing behaviors, especially around hook execution order.
- Avoid broad refactors unless explicitly requested.
- Do not add new dependencies without user approval.
- Prefer adding or updating tests alongside behavior changes.
- Keep logs concise to avoid noisy plugin output.
