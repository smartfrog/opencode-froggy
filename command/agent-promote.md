---
description: Change the type of an agent to primary, subagent or all
---

Use the `agent-promote` tool with the following arguments:
- name: $1
- grade: $2

## Parameters

| Parameter | Description | Valid values |
|-----------|-------------|--------------|
| `name` | Agent name from the plugin | `rubber-duck`, `architect`, `code-reviewer`, `code-simplifier`, `doc-writer`, `partner` |
| `grade` | Target agent type | `subagent`, `primary`, `all` |

## Grade types

| Grade | Availability | Access method |
|-------|--------------|---------------|
| `subagent` | Sub-agent only | @mention or Task tool |
| `primary` | Primary agent only | Tab selector |
| `all` | Everywhere | Tab selector, @mention, Task tool |

### Details

- **subagent**: Agent available only as a sub-agent. Can be invoked via `@agent-name` mention or through the Task tool to spawn child sessions.
- **primary**: Agent available only as a primary agent. Selectable via the Tab key in the agent selector. Cannot be used as a sub-agent.
- **all**: Agent available in all contexts. Can be selected as the main agent and also invoked as a sub-agent.

## Examples

```
/agent-promote rubber-duck subagent
/agent-promote doc-writer primary
/agent-promote architect all
```
