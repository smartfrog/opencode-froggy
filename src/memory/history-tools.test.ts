import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createKnowledgeTool } from "../tools/knowledge"
import { createTaskBoardTool } from "../tools/task-board"

const directories: string[] = []
const fixtures = [
  { name: "knowledge", createTool: createKnowledgeTool, agent: "memory-manager", field: "content", create: { topic: "runtime" } },
  { name: "task-board", createTool: createTaskBoardTool, agent: "orchestrator", field: "objective", create: {} },
]

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

for (const fixture of fixtures) {
  describe(`${fixture.name} archived reads`, () => {
    function setup() {
      const directory = mkdtempSync(join(tmpdir(), "froggy-history-"))
      directories.push(directory)
      const tool = fixture.createTool(directory)
      const context = { agent: fixture.agent, sessionID: "ses_test" }
      return { execute: (input: unknown) => tool.execute(input, context) }
    }

    it("paginates beyond the five most recent archived revisions", async () => {
      const { execute } = setup()
      await execute({ action: "save", id: "record", title: "Record", ...fixture.create, [fixture.field]: "Original" })
      for (let revision = 1; revision <= 6; revision++) {
        await execute({ action: "save", id: "record", expectedRevision: revision, [fixture.field]: `Revision ${revision + 1}` })
      }
      const first = JSON.parse((await execute({ action: "history", id: "record" })).content)
      expect(first.history.map((entry: { revision: number }) => entry.revision)).toEqual([6, 5, 4, 3, 2])
      expect(first.nextOffset).toBe(5)
      const second = JSON.parse((await execute({ action: "history", id: "record", offset: first.nextOffset })).content)
      expect(second.history.map((entry: { revision: number }) => entry.revision)).toEqual([1])
      expect(second.nextOffset).toBeNull()
    })

    it("reads the complete selected archive without changing the current record", async () => {
      const { execute } = setup()
      const original = "\u0000😀".repeat(8_000) + "TRAILING CONSTRAINT"
      await execute({ action: "save", id: "record", title: "Record", ...fixture.create, [fixture.field]: original })
      await execute({ action: "save", id: "record", expectedRevision: 1, [fixture.field]: "Current" })

      let offset: number | null = 0
      let serialized = ""
      while (offset !== null) {
        const response = await execute({ action: "history", id: "record", revision: 1, offset })
        expect(response.content.length).toBeLessThanOrEqual(20_000)
        const page = JSON.parse(response.content)
        expect(page.revision).toBe(1)
        expect(typeof page.text).toBe("string")
        serialized += page.text
        offset = page.nextOffset
      }
      expect(JSON.parse(serialized)[fixture.field]).toBe(original)
      const live = JSON.parse((await execute({ action: "get", id: "record" })).content)
      expect((live.note ?? live.task).revision).toBe(2)
      expect((live.note ?? live.task)[fixture.field]).toBe("Current")
      const history = JSON.parse((await execute({ action: "history", id: "record" })).content)
      expect(history.history.length).toBe(1)
    })
  })
}
