import { describe, expect, it } from "bun:test"
import {
  analyzeContext,
  formatCost,
  formatSessionContextMarkdown,
  formatSessionContextReport,
  formatTokens,
  modelLabel,
  parseTokens,
  type SessionContextRow,
  type SessionSummary,
} from "./session-context"

const messages = [
  { type: "system", text: "system text" },
  { type: "user", text: "hello" },
  {
    type: "assistant",
    content: [
      { type: "text", text: "answer" },
      { type: "reasoning", text: "think" },
      {
        type: "tool",
        name: "read",
        state: {
          status: "completed",
          input: { path: "x" },
          content: [{ type: "text", text: "result" }],
        },
      },
    ],
    tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 900, write: 0 } },
  },
  { type: "compaction", summary: "sum", recent: "recent" },
  { type: "shell", command: "ls", output: { output: "ok" } },
]

const session = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "ses_main",
  parentID: null,
  title: "Main session",
  agent: "plan",
  model: "deepseek/deepseek-flash#high",
  modelKey: "deepseek/deepseek-flash",
  cost: 1.25,
  tokens: { input: 1000, output: 200, cacheRead: 3000 },
  ...overrides,
})

describe("session context analysis", () => {
  it("classifies active context characters and reads the last prompt tokens", () => {
    const analysis = analyzeContext(messages, 10_000)

    expect(analysis).toMatchObject({
      messages: 5,
      characters: 58,
      promptTokens: 1000,
      contextLimit: 10_000,
      usedPercent: 10,
      attachments: 0,
    })
    expect(analysis.categories).toEqual({
      system: 11,
      user: 5,
      assistant: 6,
      reasoning: 5,
      "tool calls": 12,
      "tool results": 6,
      compaction: 9,
      other: 4,
    })
    expect(Object.values(analysis.percentages).reduce((total, value) => total + value, 0)).toBeCloseTo(100)
    expect(analysis.percentages["tool calls"]).toBeCloseTo(12 / 58 * 100)
    expect(analysis.tools).toEqual([
      { name: "read", calls: 1, callCharacters: 12, resultCharacters: 6, characters: 18 },
    ])
  })

  it("aggregates tool characters by name and counts errors as results", () => {
    const analysis = analyzeContext([{
      type: "assistant",
      content: [
        { type: "tool", name: "shell", state: { status: "completed", input: { command: "ls" }, content: [{ type: "text", text: "out" }] } },
        { type: "tool", name: "shell", state: { status: "error", input: { command: "pwd" }, content: [], error: "boom" } },
        { type: "tool", state: { status: "completed", input: {}, content: [] } },
      ],
    }], null)

    expect(analysis.tools).toEqual([
      { name: "shell", calls: 2, callCharacters: 33, resultCharacters: 9, characters: 42 },
      { name: "(unnamed)", calls: 1, callCharacters: 2, resultCharacters: 0, characters: 2 },
    ])
  })

  it("uses the last assistant step that reported prompt tokens", () => {
    const analysis = analyzeContext([
      { type: "assistant", content: [], tokens: { input: 10, cache: { read: 0, write: 0 } } },
      { type: "assistant", content: [] },
    ], 1000)

    expect(analysis.promptTokens).toBe(10)
    expect(analysis.usedPercent).toBe(1)
  })

  it("reports missing prompt tokens and limits without inventing values", () => {
    const analysis = analyzeContext([{ type: "user", text: "hi" }], null)

    expect(analysis).toMatchObject({
      messages: 1,
      characters: 2,
      promptTokens: null,
      contextLimit: null,
      usedPercent: null,
    })
  })

  it("counts attachments separately from text characters", () => {
    const analysis = analyzeContext([{ type: "user", text: "hi", files: [{ uri: "file:///tmp/a.txt", mime: "text/plain" }] }], null)

    expect(analysis).toMatchObject({ characters: 2, attachments: 1 })
  })

  it("excludes tool-returned files from character totals", () => {
    const analysis = analyzeContext([{
      type: "assistant",
      content: [{
        type: "tool",
        state: {
          status: "completed",
          input: {},
          content: [{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" }],
        },
      }],
    }], null)

    expect(analysis).toMatchObject({ attachments: 1, characters: 2 })
    expect(analysis.categories["tool results"]).toBe(0)
  })

  it("counts shell output from both API shapes", () => {
    const objectShape = analyzeContext([{ type: "shell", command: "ls", output: { output: "ok" } }], null)
    const stringShape = analyzeContext([{ type: "shell", command: "ls", output: "ok" }], null)

    expect(objectShape.categories.other).toBe(4)
    expect(stringShape.categories.other).toBe(4)
  })

  it("builds model labels and keys with optional variants", () => {
    expect(modelLabel({ providerID: "deepseek", id: "deepseek-flash", variant: "high" })).toEqual({
      label: "deepseek/deepseek-flash#high",
      key: "deepseek/deepseek-flash",
    })
    expect(modelLabel({ providerID: "openai", modelID: "gpt-6.1-sol" })).toEqual({
      label: "openai/gpt-6.1-sol",
      key: "openai/gpt-6.1-sol",
    })
    expect(modelLabel({})).toEqual({ label: "?", key: null })
  })

  it("parses cumulative token usage with safe defaults", () => {
    expect(parseTokens({ input: 1, output: 2, cache: { read: 4, write: 5 } })).toEqual({
      input: 1, output: 2, cacheRead: 4,
    })
    expect(parseTokens(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0 })
  })

  it("formats token, cost and percentage values compactly", () => {
    expect(formatTokens(999)).toBe("999")
    expect(formatTokens(1500)).toBe("1.5k")
    expect(formatTokens(1_000_000)).toBe("1.00M")
    expect(formatTokens(null)).toBe("n/a")
    expect(formatCost(0)).toBe("$0")
    expect(formatCost(0.0012)).toBe("$0.0012")
    expect(formatCost(2.576)).toBe("$2.58")
  })

  it("renders a Markdown table and category list", () => {
    const analysis = analyzeContext(messages, 10_000)
    const rows: SessionContextRow[] = [
      { session: session(), analysis, error: null },
      {
        session: session({ id: "ses_child", parentID: "ses_main", title: "Curation", agent: "memory-manager" }),
        analysis: null,
        error: "context unavailable",
      },
    ]

    const markdown = formatSessionContextMarkdown(rows, { limitError: "model offline" })

    expect(markdown).toContain("| # | Session | Agent · Model | Context / Limit (used) | Top tool | Cost | Cumul session (in/out/cache) |")
    expect(markdown).toContain("| # | Agent (kind) | Cost | reasoning | tool calls | tool results | system | compaction | assistant | user | other |")
    const categoryRows = markdown.split("### Categories")[1].split("\n")
    expect(categoryRows.find((line) => line.startsWith("| 1 |"))).toContain("| plan (main) | $1.25 |")
    expect(categoryRows.find((line) => line.startsWith("| 2 |"))).toContain("| memory-manager (sub) | $1.25 |")
    expect(markdown).toContain("| 1 | plan (main) |")
    expect(markdown).toContain("| read 18 |")
    expect(markdown).toContain("### Tools")
    expect(markdown).toContain("| read | 1 | 12 | 6 | 100.0% |")
    expect(markdown).toContain("19.0%")
    expect(markdown).toContain("| **Global** | **all sessions** | **$2.50** |")
    expect(markdown).toContain("**19.0%**")
    expect(markdown).toContain("- **#2** error: context unavailable")
    expect(markdown).toContain("**Model limits unavailable:** model offline")
  })

  it("renders main and subagent rows with categories and errors", () => {
    const analysis = analyzeContext(messages, 10_000)
    const rows: SessionContextRow[] = [
      { session: session(), analysis, error: null },
      {
        session: session({ id: "ses_child", parentID: "ses_main", title: "Curation", agent: "memory-manager", model: "deepseek/deepseek-flash#high" }),
        analysis: null,
        error: "context unavailable",
      },
    ]

    const report = formatSessionContextReport(rows, { limitError: "model offline" })

    expect(report).toContain("Active context — 2 most recent sessions")
    expect(report).toContain("Model limits unavailable: model offline")
    expect(report).toContain("main")
    expect(report).toContain("sub")
    expect(report).toContain("memory-manager")
    expect(report).toContain("deepseek/deepseek-flash#high")
    expect(report).toContain("categories: reasoning")
    expect(report).toContain("system 19.0%")
    expect(report).toContain("top tool: read 18 (100.0% of tool chars)")
    expect(report).toContain("Tools (all sessions)")
    expect(report).toContain("error: context unavailable")
    expect(report).toContain("Cumul session")
    expect(report).toContain("Source: messages after the last compaction.")
  })
})
