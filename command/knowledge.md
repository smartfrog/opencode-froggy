---
description: Browse or search project knowledge
---

Call the `knowledge` tool once and map these arguments:

- empty: `action: "topics"`.
- `list [topic]`: `action: "list"`, optional `topic`.
- `search <text>`: `action: "search"`, `query: "<text>"`.
- `get <ID>`: `action: "get"`, `id: "<ID>"`.
- anything else: reply with `Usage: /knowledge [list [topic]|search <text>|get <ID>]`.

Arguments: `$ARGUMENTS`

Return the tool's `content` exactly as-is: no code fence, summary, translation or added commentary. If it fails because no project memory database exists, say so in one sentence.
