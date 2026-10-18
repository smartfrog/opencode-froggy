import { textResponse } from "../memory/bounds"
import { openProjectMemory } from "../memory/project"
import { inputRecord } from "../memory/tool-input"
import { formatOverview, readInventory } from "../memory/views"

export function createMemoryOverviewTool(directory: string) {
  return {
    name: "memory-overview",
    options: { codemode: false },
    description: "Read-only project memory overview as Markdown: store path, task counts by status and knowledge entries per topic. Never creates, upgrades or changes memory; use memory-review only to audit content.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(input: unknown) {
      inputRecord(input, [])
      const { path, store } = openProjectMemory(directory, { readonly: true })
      try {
        const { topics, knowledgeCount } = readInventory(store)
        return textResponse(formatOverview(path, store.taskCounts(), topics, knowledgeCount))
      } finally {
        store.close()
      }
    },
  }
}
