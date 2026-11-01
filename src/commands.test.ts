import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { loadCommands } from "./loaders"

const commands = loadCommands(fileURLToPath(new URL("../command/", import.meta.url)))

describe("memory inspection commands", () => {
  it.each([
    ["memory", "memory-overview", []],
    ["task-board", "task-board", ['status: "done"', 'action: "get"', "$ARGUMENTS"]],
    ["knowledge", "knowledge", ['action: "topics"', 'action: "search"', "$ARGUMENTS"]],
  ])("loads /%s as a relay of %s output", (name, tool, snippets) => {
    const command = commands[name]
    expect(command).toBeDefined()
    expect(command.template).toContain(`\`${tool}\``)
    expect(command.template).toContain("exactly as-is")
    for (const snippet of snippets) expect(command.template).toContain(snippet)
  })
})
