---
description: Show project tasks as status columns or one task
---

Call the `task-board` tool once and map these arguments:

- empty: `action: "list"`.
- `done`: `action: "list"`, `status: "done"`.
- `list <status>`: `action: "list"`, `status: "<status>"`.
- `get <ID>`: `action: "get"`, `id: "<ID>"`.
- anything else: reply with `Usage: /task-board [list <status>|done|get <ID>]`.

Arguments: `$ARGUMENTS`

Return the tool's `content` exactly as-is: no code fence, summary, translation or added commentary. If it fails because no project memory database exists, say so in one sentence.
