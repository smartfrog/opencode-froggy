import { response } from "../memory/bounds"
import { openProjectMemory } from "../memory/project"
import { inputRecord, pageNumber } from "../memory/tool-input"

const TOPICS_PER_PAGE = 20

export function createMemoryReviewTool(directory: string) {
  return {
    name: "memory-review",
    options: { codemode: false },
    description: "Read-only inventory for an on-demand global knowledge review: topic counts and total entries, paginated with nextPage. This tool does not assess content, invoke an agent or change memory. The read-only memory-reviewer uses knowledge list/get and proposes changes for user validation; memory-manager applies approved proposals separately.",
    input: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 0, description: "Use nextPage from the previous inventory response" },
      },
      additionalProperties: false,
    },
    async execute(input: unknown) {
      const args = inputRecord(input, ["page"])
      const page = pageNumber(args.page)
      const { path, store } = openProjectMemory(directory, { readonly: true })
      try {
        const inventory = store.knowledgeInventory(TOPICS_PER_PAGE, page * TOPICS_PER_PAGE)
        return response({
          path, ...inventory,
          nextPage: (page + 1) * TOPICS_PER_PAGE < inventory.topicCount ? page + 1 : null,
        })
      } finally {
        store.close()
      }
    },
  }
}
