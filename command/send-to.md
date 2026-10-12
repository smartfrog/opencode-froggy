---
description: Send a message to a child session (subagent) to continue the conversation
---

Continue an existing child session using the native `subagent` tool. Use this command for same-subject follow-ups; create a new session for an independent objective.

Messages steer ongoing work at the next step boundary and may wait for a running model request or tool. Send follow-up work intended for later when the current execution has completed.

Parse the input:
- If the first word matches a known agent type (e.g., `rubber-duck`, `explore`, `general`, `architect`, `doc-writer`, `partner`), use it to find the matching session and send the rest as the message
- Otherwise, send the entire input to the most recent child session

Steps:
1. Identify the intended child using recorded task, agent, and session associations in the conversation. Use `list-child-sessions` to supplement these records; its in-memory list may be incomplete after a restart. If an agent type is specified, select the most recent matching child; otherwise select the most recent child.
2. Recover the child's original agent from the recorded association or session metadata, rather than guessing from its title. If the intended session or agent cannot be identified, ask the user to clarify the target.
3. Call `subagent` with the selected `sessionID`, the same `agent`, the message as `prompt`, a short `description`, and `background: true`.
4. Rely on OpenCode's completion notification for the resumed execution.

Input: $ARGUMENTS
