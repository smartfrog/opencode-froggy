import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createKnowledgeTool } from "./knowledge"

const directories: string[] = []
const CONTEXT = { agent: "memory-manager", sessionID: "ses_test" }

function tool(): ReturnType<typeof createKnowledgeTool> {
  const directory = mkdtempSync(join(tmpdir(), "froggy-knowledge-"))
  directories.push(directory)
  return createKnowledgeTool(directory)
}

function result(value: { content: string }): Record<string, unknown> {
  return JSON.parse(value.content) as Record<string, unknown>
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("knowledge tool", () => {
  it("saves, finds and reads a note", async () => {
    const memory = tool()
    expect(result(await memory.execute({
      action: "save",
      id: "runtime-cycles",
      topic: "runtime",
      kind: "lesson",
      title: "Cycles during idle",
      content: "Check idle cycle accounting.",
    }, CONTEXT))).toMatchObject({ id: "runtime-cycles", revision: 1, created: true })

    expect(result(await memory.execute({ action: "search", query: "accounting" }, CONTEXT))).toMatchObject({
      results: [{ id: "runtime-cycles", topic: "runtime" }],
    })
    expect(result(await memory.execute({ action: "get", id: "runtime-cycles" }, CONTEXT))).toMatchObject({
      note: { id: "runtime-cycles", content: "Check idle cycle accounting." },
    })
  })

  it("reports project rules and topics in the overview", async () => {
    const memory = tool()
    await memory.execute({
      action: "save",
      id: "project-rules",
      topic: "rules",
      kind: "constraint",
      title: "Project rules",
      content: "Never publish private packages.",
    }, CONTEXT)
    await memory.execute({
      action: "save",
      id: "build-link",
      topic: "build",
      kind: "fact",
      title: "Linker workaround",
      content: "Keep the weak symbol.",
    }, CONTEXT)

    expect(result(await memory.execute({ action: "overview" }, CONTEXT))).toMatchObject({
      total: 2,
      projectRules: { id: "project-rules" },
      topics: [{ topic: "build", count: 1 }, { topic: "rules", count: 1 }],
    })
  })

  it("rejects a writer other than memory-manager", async () => {
    const memory = tool()
    await expect(memory.execute({
      action: "save",
      id: "forbidden",
      topic: "runtime",
      kind: "fact",
      title: "Forbidden",
      content: "No.",
    }, { agent: "build", sessionID: "ses_test" })).rejects.toThrow("Only memory-manager")
  })

  it("rejects a stale revision", async () => {
    const memory = tool()
    await memory.execute({
      action: "save",
      id: "note",
      topic: "runtime",
      kind: "fact",
      title: "Note",
      content: "One.",
    }, CONTEXT)
    await memory.execute({
      action: "save",
      id: "note",
      expectedRevision: 1,
      content: "Two.",
    }, CONTEXT)

    await expect(memory.execute({
      action: "save",
      id: "note",
      expectedRevision: 1,
      content: "Three.",
    }, CONTEXT)).rejects.toThrow("expected revision 1, current 2")
  })

  it("rejects an invalid replacement id without changing the note", async () => {
    const memory = tool()
    await memory.execute({
      action: "save", id: "note", topic: "runtime", title: "Note", content: "Keep this constraint.",
    }, CONTEXT)

    await expect(memory.execute({
      action: "save", id: "note", expectedRevision: 1, supersededBy: "x".repeat(21_000),
    }, CONTEXT)).rejects.toThrow("Invalid supersededBy")

    expect(result(await memory.execute({ action: "get", id: "note" }, CONTEXT))).toMatchObject({
      note: { revision: 1, supersededBy: null, content: "Keep this constraint." },
    })
    expect(result(await memory.execute({ action: "history", id: "note" }, CONTEXT))).toMatchObject({ history: [] })
  })

  it("bounds overview topics and exposes a continuation", async () => {
    const memory = tool()
    for (let index = 0; index < 40; index++) {
      await memory.execute({
        action: "save",
        id: `note-${index}`,
        topic: `topic-${index}`,
        kind: "fact",
        title: `${"title".repeat(80)}-${index}`,
        content: "Body.",
      }, CONTEXT)
    }

    const overview = await memory.execute({ action: "overview" }, CONTEXT)
    const body = result(overview)
    expect(overview.content.length).toBeLessThanOrEqual(20_000)
    expect(body.nextOffset).toBe(30)
    expect((body.topics as unknown[]).length).toBe(30)
  })

  it("reports truncated topic and title metadata and still reads them completely", async () => {
    const memory = tool()
    const topic = "topic".repeat(20)
    const title = "title".repeat(50)
    await memory.execute({
      action: "save", id: "note", topic, kind: "fact", title, content: "Body.",
    }, CONTEXT)

    const detail = result(await memory.execute({ action: "get", id: "note" }, CONTEXT)) as {
      note: { truncated: string[]; hint: string | null }
    }
    expect(detail.note.truncated).toEqual(["topic", "title"])
    expect(detail.note.hint).not.toBeNull()

    expect(result(await memory.execute({
      action: "get", id: "note", field: "topic", expectedRevision: 1,
    }, CONTEXT))).toMatchObject({ text: topic })
    expect(result(await memory.execute({
      action: "get", id: "note", field: "title", expectedRevision: 1,
    }, CONTEXT))).toMatchObject({ text: title })
  })

  it("bounds search metadata", async () => {
    const memory = tool()
    await memory.execute({
      action: "save",
      id: "long",
      topic: "topic".repeat(200),
      kind: "fact",
      title: "title".repeat(2_000),
      content: "Searchable body.",
    }, CONTEXT)

    const search = await memory.execute({ action: "search", query: "Searchable" }, CONTEXT)
    expect(search.content.length).toBeLessThanOrEqual(20_000)
    expect(result(search)).toMatchObject({
      results: [{ truncated: ["topic", "title"] }],
    })
  })

  it.each(["😀", "\u0000"])("paginates overview within its serialized budget for %j", async (character) => {
    const memory = tool()
    await memory.execute({
      action: "save", id: "project-rules", topic: "rules", title: "Rules", content: character.repeat(2_500),
    }, CONTEXT)
    for (let topic = 0; topic < 30; topic++) {
      for (let note = 0; note < 3; note++) {
        await memory.execute({
          action: "save", id: `note-${topic}-${note}`, topic: `${character.repeat(80)}-${topic}`,
          title: character.repeat(120), content: "Body",
        }, CONTEXT)
      }
    }

    const first = await memory.execute({ action: "overview" }, CONTEXT)
    expect(first.content.length).toBeLessThanOrEqual(20_000)
    const narrow = result(await memory.execute({ action: "overview", limit: 1 }, CONTEXT))
    expect((narrow.topics as unknown[]).length).toBe(1)
    expect(narrow.nextOffset).toBe(1)

    const topics: unknown[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const response = await memory.execute({ action: "overview", offset }, CONTEXT)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const page = result(response) as { topics: unknown[]; nextOffset: number | null }
      topics.push(...page.topics)
      offset = page.nextOffset
    }
    expect(topics.length).toBe(31)
  })

  it("reads a complete accepted note through revision-checked ranges", async () => {
    const memory = tool()
    const content = "A".repeat(40_000) + "TRAILING"
    await memory.execute({
      action: "save",
      id: "long-note",
      topic: "runtime",
      kind: "constraint",
      title: "Long note",
      content,
    }, CONTEXT)

    const first = result(await memory.execute({ action: "get", id: "long-note" }, CONTEXT)) as {
      note: { content: string; hasMore: boolean }
    }
    expect(first.note.hasMore).toBe(true)

    let offset = 0
    let rebuilt = ""
    while (offset !== null) {
      const page = result(await memory.execute({
        action: "get",
        id: "long-note",
        expectedRevision: 1,
        offset,
        limit: 10_000,
      }, CONTEXT)) as { note: { content: string; nextOffset: number | null } }
      rebuilt += page.note.content
      offset = page.note.nextOffset ?? 0
      if (page.note.nextOffset === null) break
    }

    expect(rebuilt).toBe(content)
    expect(result(await memory.execute({ action: "history", id: "long-note" }, CONTEXT))).toMatchObject({
      history: [],
    })
  })

  it("rejects a ranged read pinned to a stale revision", async () => {
    const memory = tool()
    await memory.execute({
      action: "save",
      id: "note",
      topic: "runtime",
      kind: "fact",
      title: "Note",
      content: "One.",
    }, CONTEXT)
    await memory.execute({
      action: "save",
      id: "note",
      expectedRevision: 1,
      content: "Two.",
    }, CONTEXT)

    await expect(memory.execute({
      action: "get",
      id: "note",
      expectedRevision: 1,
    }, CONTEXT)).rejects.toThrow("expected revision 1, current 2")
  })

  it("hides historical snapshots unless requested", async () => {
    const memory = tool()
    await memory.execute({
      action: "save",
      id: "note",
      topic: "runtime",
      kind: "fact",
      title: "Note",
      content: "One.",
    }, CONTEXT)
    await memory.execute({
      action: "save",
      id: "note",
      expectedRevision: 1,
      content: "Two.",
    }, CONTEXT)

    const history = result(await memory.execute({ action: "history", id: "note" }, CONTEXT))
    expect(history).toMatchObject({
      history: [{ revision: 1, entityId: "note" }],
    })
    expect("snapshot" in (history.history as Record<string, unknown>[])[0]).toBe(false)
  })
})
