export interface ChildTurnResult {
  state: "completed" | "error"
  text: string
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function lastTextPart(message: unknown): string {
  const content = asRecord(message).content
  if (!Array.isArray(content)) return ""
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = asRecord(content[index])
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      return part.text.trim()
    }
  }
  return ""
}

function findAnchorIndex(messages: unknown[], since: number, anchorID?: string): number {
  for (let index = 0; index < messages.length; index += 1) {
    const message = asRecord(messages[index])
    if (anchorID !== undefined) {
      if (message.id === anchorID) return index
      continue
    }
    if (message.type !== "user") continue
    const created = asRecord(message.time).created
    if (typeof created === "number" && created >= since) return index
  }
  return anchorID !== undefined ? findAnchorIndex(messages, since) : -1
}

export function resolveChildTurn(
  messages: unknown,
  since: number,
  anchorID?: string,
): ChildTurnResult | null {
  if (!Array.isArray(messages)) return null
  const anchorIndex = findAnchorIndex(messages, since, anchorID)
  if (anchorIndex < 0) return null

  let lastAssistant: unknown
  for (let index = anchorIndex + 1; index < messages.length; index += 1) {
    const message = asRecord(messages[index])
    if (message.type === "assistant") {
      lastAssistant = message
    }
    if (message.type === "idle") {
      return {
        state: message.outcome === undefined || message.outcome === "succeeded" ? "completed" : "error",
        text: lastTextPart(lastAssistant),
      }
    }
  }
  return null
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}

export function renderSubagentCompletion(input: {
  sessionID: string
  state: "completed" | "error"
  description?: string
  text: string
}): string {
  const description = input.description ? ` description="${escapeAttribute(input.description)}"` : ""
  return [
    `<subagent sessionID="${input.sessionID}" state="${input.state}"${description}>`,
    input.text,
    "</subagent>",
  ].join("\n")
}
