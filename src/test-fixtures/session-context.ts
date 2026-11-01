import { type SessionSummary } from "../session-context"

const MAIN_SESSION: SessionSummary = {
  id: "ses_main",
  parentID: null,
  title: "Main session",
  agent: "plan",
  model: "deepseek/deepseek-flash#high",
  modelKey: "deepseek/deepseek-flash",
  cost: 1.25,
  tokens: { input: 1000, output: 200, cacheRead: 3000 },
}

export const CHILD_SESSION: SessionSummary = {
  ...MAIN_SESSION,
  id: "ses_child",
  parentID: MAIN_SESSION.id,
  title: "Curation",
  agent: "memory-manager",
  cost: 2.5,
}

export const SESSION_SUMMARIES = [MAIN_SESSION, CHILD_SESSION]
export const CONTEXT_MESSAGES = [
  { type: "user", text: "RAW_SECRET_MARKER" },
  {
    type: "assistant",
    content: [{ type: "text", text: "ok" }],
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 900, write: 0 } },
  },
]
