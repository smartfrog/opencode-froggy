import { describe, expect, it, vi } from "vitest"
import { readOrchestratorActivity, type ActivitySessionClient } from "./orchestrator-activity"

const child = (id: string, directory = "/worktree") => ({
  id, agent: "general", title: `Task ${id}`, location: { directory },
})

describe("orchestrator activity", () => {
  it("lists all child pages and reads running shells from their worktree locations", async () => {
    const list = vi.fn<ActivitySessionClient["list"]>()
      .mockResolvedValueOnce({ data: [child("ses_a", "/worktree-a")], cursor: { next: "page2" } })
      .mockResolvedValueOnce({ data: [child("ses_b", "/worktree-b")] })
    const active = vi.fn(async () => ({ ses_a: { type: "running" } }))
    const shells = {
      list: vi.fn(async ({ location }: { location: { directory: string } }) => ({
        data: location.directory === "/worktree-b"
          ? [{ id: "sh_build", status: "running", metadata: { sessionID: "ses_b" } }]
          : [],
      })),
    }

    const result = await readOrchestratorActivity({ list, active }, shells, "ses_parent")

    expect(list).toHaveBeenNthCalledWith(2, { parentID: "ses_parent", limit: "20", cursor: "page2" })
    expect(shells.list).toHaveBeenCalledWith({ location: { directory: "/worktree-a" } })
    expect(shells.list).toHaveBeenCalledWith({ location: { directory: "/worktree-b" } })
    expect(result).toContain("ses_a | general | running")
    expect(result).toContain("ses_b | general | inactive | running shells: sh_build")
  })

  it("does not attribute another session's shell to an inactive child", async () => {
    const session = {
      list: vi.fn(async () => ({ data: [child("ses_a"), child("ses_b")] })),
      active: vi.fn(async () => ({})),
    }
    const shells = {
      list: vi.fn(async () => ({ data: [{ id: "sh_other", status: "running", metadata: { sessionID: "ses_unrelated" } }] })),
    }

    const result = await readOrchestratorActivity(session, shells, "ses_parent")

    expect(shells.list).toHaveBeenCalledOnce()
    expect(result).not.toContain("sh_other")
    expect(result).toContain("ses_a | general | inactive | running shells: none")
    expect(result).toContain("ses_b | general | inactive | running shells: none")
  })

  it("propagates inspection failures instead of reporting an empty workload", async () => {
    const failure = new Error("Session list unavailable")
    const session = {
      list: vi.fn(async () => { throw failure }),
      active: vi.fn(async () => ({})),
    }
    const shells = { list: vi.fn(async () => ({ data: [] })) }

    await expect(readOrchestratorActivity(session, shells, "ses_parent")).rejects.toBe(failure)
  })
})
