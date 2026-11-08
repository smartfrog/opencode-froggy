import { asRecord } from "../record"
import { recordId, versionInput } from "./tool-input"

export interface TextEdit {
  oldText: string
  newText: string
}

export const TARGETED_TEXT_PROPERTIES = {
  pattern: { type: "string", minLength: 1, description: "grep only: case-sensitive literal within body lines of one required id; no CR/LF, regex or flags" },
  context: { type: "integer", minimum: 0, maximum: 10, default: 2, description: "grep only: surrounding body lines per match; default 2, merged windows, complete output" },
  edits: {
    type: "array", minItems: 1,
    description: "edit only: atomic description/content replacements on one existing id with expectedVersion. Every oldText must match exactly once in the original body; overlaps are rejected. Use save for metadata.",
    items: {
      type: "object",
      properties: { oldText: { type: "string", minLength: 1 }, newText: { type: "string" } },
      required: ["oldText", "newText"], additionalProperties: false,
    },
  },
} as const

function textEdits(value: unknown): TextEdit[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("edits must be a nonempty array")
  return value.map((item) => {
    const edit = asRecord(item)
    if (Object.keys(edit).some((key) => key !== "oldText" && key !== "newText")) throw new Error("Unsupported edit parameter")
    if (typeof edit.oldText !== "string" || !edit.oldText) throw new Error("oldText must be a nonempty string")
    if (typeof edit.newText !== "string") throw new Error("newText must be a string")
    return { oldText: edit.oldText, newText: edit.newText }
  })
}

export function targetedTextInput(args: Record<string, unknown>): { grep?: { pattern: string; context: number }; edits?: TextEdit[] } {
  if (args.action !== "grep" && args.action !== "edit") {
    for (const key of ["pattern", "context", "edits"]) {
      if (key in args) throw new Error(`${key} is only valid for ${key === "edits" ? "edit" : "grep"}`)
    }
    return {}
  }
  const fields = args.action === "grep"
    ? ["action", "id", "pattern", "context"]
    : ["action", "id", "expectedVersion", "edits"]
  for (const key of Object.keys(args)) {
    if (!fields.includes(key)) throw new Error(`${key} is not valid for ${args.action}`)
  }
  recordId(args.id)
  if (args.action === "edit") {
    if (versionInput(args.expectedVersion) === null) throw new Error("expectedVersion is required for edit")
    return { edits: textEdits(args.edits) }
  }
  if (typeof args.pattern !== "string" || !args.pattern || args.pattern.includes("\n") || args.pattern.includes("\r")) {
    throw new Error("pattern must be a nonempty literal string without CR/LF")
  }
  const context = "context" in args ? args.context : 2
  if (typeof context !== "number" || !Number.isSafeInteger(context) || context < 0 || context > 10) {
    throw new Error("context must be a safe integer from 0 to 10")
  }
  return { grep: { pattern: args.pattern, context } }
}

export function literalGrep(content: string, pattern: string, context: number) {
  const lines = content.split("\n")
  const windows: { start: number; end: number }[] = []
  let matches = 0
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes(pattern)) continue
    matches++
    const start = Math.max(0, index - context)
    const end = Math.min(lines.length, index + context + 1)
    const previous = windows.at(-1)
    if (previous && start <= previous.end) previous.end = end
    else windows.push({ start, end })
  }
  return {
    matches,
    windows: windows.map(({ start, end }) => lines.slice(start, end)
      .map((line, index) => `${start + index + 1}: ${line}`).join("\n")),
  }
}

export function applyTextEdits(content: string, edits: readonly TextEdit[]): string {
  const replacements = textEdits(edits).map(({ oldText, newText }, index) => {
    const start = content.indexOf(oldText)
    if (start === -1) throw new Error(`Edit ${index + 1}: oldText not found in original content`)
    if (content.indexOf(oldText, start + 1) !== -1) throw new Error(`Edit ${index + 1}: oldText is ambiguous in original content`)
    return { start, end: start + oldText.length, newText, index }
  }).sort((left, right) => left.start - right.start)
  let end = 0
  const parts: string[] = []
  for (const replacement of replacements) {
    if (replacement.start < end) throw new Error(`Edit ${replacement.index + 1}: edits overlap in original content`)
    parts.push(content.slice(end, replacement.start), replacement.newText)
    end = replacement.end
  }
  parts.push(content.slice(end))
  return parts.join("")
}
