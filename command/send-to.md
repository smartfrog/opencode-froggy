---
description: Send a message to a child session (subagent) to continue the conversation
---

Send a message to a child session using the `prompt-session` tool.

Parse the input:
- If the first word matches a known agent type (e.g., `rubber-duck`, `explore`, `general`, `architect`, `doc-writer`, `partner`), use it to find the matching session and send the rest as the message
- Otherwise, send the entire input to the most recent child session

Steps:
1. Parse the input to check if the first word is an agent type
2. If agent type specified:
   - List all child sessions using `list-child-sessions` tool
   - Find the session that matches the agent type (by title or context)
   - If multiple match, use the most recent one
   - Send the rest of the input as the message using `prompt-session` tool with the matching `sessionId`
3. If no agent type specified:
   - Use the `prompt-session` tool without `sessionId` to send to the last child session

Input: $ARGUMENTS
