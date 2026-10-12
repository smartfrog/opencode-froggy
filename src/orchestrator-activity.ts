import { asRecord } from "./record"

interface ChildInfo {
  id: string
  agent?: string
  title?: string
  location: { directory: string }
}

export interface ActivitySessionClient {
  list(input: { parentID: string; limit: string; cursor?: string }): Promise<{
    data: ChildInfo[]
    cursor?: { next?: string }
  }>
  active(): Promise<Record<string, { type: string }>>
}

interface ActivityShellClient {
  list(input: { location: { directory: string } }): Promise<{
    data: { id: string; status: string; metadata: unknown }[]
  }>
}

async function listChildren(session: ActivitySessionClient, parentID: string): Promise<ChildInfo[]> {
  const children: ChildInfo[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await session.list({ parentID, limit: "20", ...(cursor ? { cursor } : {}) })
    children.push(...page.data)
    cursor = page.data.length ? page.cursor?.next : undefined
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("Child session pagination did not advance")
      cursors.add(cursor)
    }
  } while (cursor)
  return children
}

export async function readOrchestratorActivity(
  session: ActivitySessionClient,
  shell: ActivityShellClient,
  sessionID: string,
): Promise<string> {
  const [children, active] = await Promise.all([listChildren(session, sessionID), session.active()])
  if (children.length === 0) return "No child sessions found for this parent."
  const directories = [...new Set(children.map((child) => child.location.directory))]
  const pages = await Promise.allSettled(directories.map((directory) => shell.list({ location: { directory } })))
  const inspections = new Map(directories.map((directory, index) => [directory, pages[index]]))
  const runningShells = pages
    .flatMap((page) => page.status === "fulfilled" ? page.value.data : [])
    .filter((item) => item.status === "running")
  return [
    "Child activity snapshot (inactive does not mean the task is finished):",
    ...children.map((child) => {
      const inspection = inspections.get(child.location.directory)!
      const shellActivity = runningShells
        .filter((item) => asRecord(item.metadata).sessionID === child.id)
        .map((item) => item.id)
      if (inspection.status === "rejected") {
        shellActivity.push(`unknown (${String(inspection.reason)})`)
      }
      return `- ${child.id} | ${child.agent ?? "unknown agent"} | ${active[child.id]?.type ?? "inactive"}` +
        ` | running shells: ${shellActivity.join(", ") || "none"} | ${JSON.stringify(child.title ?? "Untitled")}`
    }),
  ].join("\n")
}
