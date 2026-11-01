import { type NoteRecord, type TaskRecord, type TaskStatus } from "./store"

function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim()
}

export function formatBoard(tasks: TaskRecord[], columns: TaskStatus[]): string {
  const grouped = columns.map((status) => tasks.filter((task) => task.status === status))
  const rows: string[] = []
  const height = Math.max(...grouped.map((items) => items.length))
  for (let row = 0; row < height; row++) {
    rows.push(`| ${grouped.map((items) => items[row] ? `${items[row].id} — ${text(items[row].title)}` : "—").join(" | ")} |`)
  }
  if (rows.length === 0) rows.push(`| ${columns.map(() => "—").join(" | ")} |`)
  return [
    `| ${columns.map((status, index) => `${status} (${grouped[index].length})`).join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
    ...rows,
  ].join("\n")
}

export function formatOverview(path: string, counts: { status: TaskStatus; count: number }[], topics: { topic: string; count: number }[], knowledgeCount: number): string {
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  return [
    `Store: \`${path}\``,
    "",
    "| Status | Tasks |",
    "|---|---:|",
    ...counts.map(({ status, count }) => `| ${status} | ${count} |`),
    `| **Total** | **${total}** |`,
    "",
    ...formatKnowledgeTopics(topics, knowledgeCount).split("\n"),
  ].join("\n")
}

export function formatTaskDetails(task: TaskRecord): string {
  return [
    `**${task.id}** — ${text(task.title)}`, "", `Status: ${task.status}`, `Version: ${task.version}`, "",
    task.description.trim() ? task.description : "_(no description)_",
  ].join("\n")
}

export function formatKnowledgeTopics(topics: { topic: string; count: number }[], knowledgeCount: number): string {
  return [
    "| Topic | Entries |",
    "|---|---:|",
    ...(topics.length ? topics.map(({ topic, count }) => `| ${text(topic)} | ${count} |`) : ["| (none) | 0 |"]),
    `| **Total** | **${knowledgeCount}** |`,
  ].join("\n")
}

export function formatKnowledgeList(notes: NoteRecord[]): string {
  return [
    "| ID | Topic | Title |",
    "|---|---|---|",
    ...notes.map((note) => `| ${note.id} | ${text(note.topic)} | ${text(note.title)} |`),
  ].join("\n")
}

export function formatKnowledgeSearch(notes: NoteRecord[]): string {
  return [
    "| ID | Topic | Title | Excerpt |",
    "|---|---|---|---|",
    ...notes.map((note) => `| ${note.id} | ${text(note.topic)} | ${text(note.title)} | ${text(note.content.replace(/\s+/g, " ").slice(0, 200))} |`),
  ].join("\n")
}

export function formatKnowledgeNote(note: NoteRecord): string {
  return [`**${note.id}** — ${text(note.title)}`, "", `Topic: ${note.topic}`, `Version: ${note.version}`, "", note.content].join("\n")
}
