# Project memory

Froggy keeps two things: **simple task tracking** and **valuable project knowledge**.
The goal is to recover what matters, not to preserve a journal of everything that happened.

```mermaid
flowchart LR
    C[Coordinator: facts and decisions] --> M[Memory manager: curate]
    M --> T[Tasks and short progress notes]
    M --> K[Project knowledge]
    A[All agents] -->|read| T
    A -->|read| K
```

## Tasks

A task has a stable **ID**, **title**, **status**, and **detailed description**.
Statuses are `todo`, `in-progress`, `blocked`, `review`, and `done`.

The description holds scope, acceptance, current state, next step and useful evidence links.
Keep session/workspace references there when needed to resume work.
Short progress notes record meaningful advances or blockers, at most 500 characters each.
They are not a log: update an obsolete description rather than burying corrections in notes.

The coordinator decides assignments and acceptance. A dispatched worker is not proof of
execution, and a passing static check is not proof that the product objective is achieved.

## Project knowledge

Each entry has an **ID**, **topic**, **title**, and **content** in Markdown.
Topics fit the project: for example `constraints`, `performance`, `build` or `runtime`.
Include useful source links in the content, not separate metadata fields.

Keep information that can change a future decision:

- user constraints and safety limits;
- reproducible performance tips and their conditions;
- build pitfalls, failure causes and recovery procedures;
- non-obvious project facts and design decisions with their reasons.

For example, a 6 GiB memory ceiling or a measured scheduler optimization belongs here.
“Trial #14 launched; results pending” belongs in the task. Raw logs stay in linked files.
Do not duplicate facts already adequately covered by project instructions or documentation.

## The memory manager decides

All agents read directly. **Only `memory-manager` writes tasks and knowledge.**
The coordinator supplies verified facts, decisions, bounded scope and evidence—not final
prose to copy. The manager decides what to add, correct, merge, refuse or remove.
`No change` is a valid result; quantity is not a quality measure.

Before creating an entry, the manager searches for an existing home. It preserves uncertainty
and does not invent acceptance or authorization. Old or rarely read knowledge is not
automatically useless. Unique constraints, unresolved risks and recovery information stay
unless explicit evidence supersedes them.

`knowledge remove` is **permanent deletion**, with no archive or undo. Read the full entry
first. Save and verify merged content before deleting duplicates, and reconcile affected
references. When uncertain, keep the entry. The handback lists changed IDs, returned
versions, deletion reasons, conflicts and partial writes.

Tool checks restrict mutations to the manager's agent context. This is not an OS sandbox:
agents must not bypass the tools with SQL, shell or file edits.

## Reading and writing

Use `/memory`, `/task-board` and `/knowledge` to inspect tasks and knowledge without modifying them. Each command calls one tool; the tool returns Markdown and the model relays it unchanged. Read the relevant task with `task-board get`. Discover knowledge with `topics`/`list`/`search`,
then `get` only matching entries. Do not load the whole project on every reminder.
`project-rules`, if present, is an ordinary knowledge entry, not a special backend.

Reads return complete Markdown. Narrow with a status, topic or query when a result is too
large. Record `get` shows the current version. Lists are discovery views, not immutable
snapshots while other sessions write.

Task details and progress notes are read from one database snapshot. The plugin does not
cap Markdown responses or impose a display-driven limit on descriptions or knowledge content.

Create records without `expectedVersion`. Updating or removing an existing record requires
its current version. Versions are opaque conflict guards, not public history; never calculate
the next value. On conflict, report it and reread before deciding how to reconcile.
Progress-note appends can also supply `expectedVersion`; an append advances the task's version.

## On-demand global review

Run `/memory-review` to ask the manager for a **report before any changes**. The read-only
`memory-review` tool inventories all topics and counts, in pages; it does not judge content
or invoke an agent. The manager then reads every knowledge entry with the existing tools,
checking duplicates across topics, contradictions, obsolete claims and useful missing facts.
Tasks are consulted only for context or affected references, not audited or changed.

The report states actual coverage, proposed changes with IDs/versions and reasons, and any
uncertainty or incomplete reads. It is not a frozen snapshot. No review changes are applied
until the user validates the proposals; application is a separate manager pass using fresh
versions. There is no scheduled global sweep. Without a database or the current schema,
the inventory reports a blocker instead of creating or migrating a store.

## Tool reference

| Tool | Actions | Record fields |
|---|---|---|
| `task-board` | `list`, `get`, `save`, `note` | `id`, `title`, `status`, `description`; `note` adds a short progress note |
| `knowledge` | `topics`, `list`, `search`, `get`, `save`, `remove` | `id`, `topic`, `title`, `content`; `query` searches text |
| `memory-overview` | none | Read-only store path, task counts by status and knowledge topics |
| `memory-review` | `page` | Read-only inventory: `knowledgeCount`, `topicCount`, `topics` and `nextPage` |

`task-board`, `knowledge` and `memory-overview` return Markdown; their write actions return
JSON receipts. `expectedVersion` guards updates. Task lists filter by `status`; knowledge
lists/searches filter by `topic`. The live tool schemas are the parameter reference.
Use `memory-overview` to consult memory and `memory-review` only to prepare a cleanup audit.

## Storage and upgrades

One SQLite database lives at `<canonical-project>/.opencode/memory/memory.db`, shared
across project worktrees. It contains `tasks`, `task_notes`, and `knowledge`, with internal
versions and timestamps. Reports and session history remain separate.

On first write access to the previous structured schema, Froggy creates and verifies a standalone
`memory.db.pre-simple-<unique-id>.bak` before converting in a transaction. Task details and
references move into the description; active knowledge retains content and source links.
Oversized legacy titles/topics get bounded labels with their full originals retained in the content.
Archived tasks become `done` with an explanatory description. Superseded notes and old
revisions remain in the backup, not the current store. IDs are preserved; versions reset.
Failed conversions roll back. Stop old plugin instances before upgrading; mixing schemas
is unsupported. Backups are never automatically deleted or published. Reads never create or
upgrade the store: they report a missing database or an outdated schema instead.

The Markdown memory tool has been removed. Existing Markdown files are neither imported
nor deleted automatically. A project still using them needs an explicit migration, not two
simultaneously authoritative stores. The database and its backups are local project data:
code commits do not protect them unless explicitly included.
