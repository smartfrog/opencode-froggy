export interface ChildSessionInfo {
  id: string
  parentID: string
  title?: string
  created: number
  updated: number
}

export class ChildSessionTracker {
  private childrenByParent = new Map<string, Map<string, ChildSessionInfo>>()

  trackChild(info: ChildSessionInfo): void {
    let children = this.childrenByParent.get(info.parentID)
    if (!children) {
      children = new Map()
      this.childrenByParent.set(info.parentID, children)
    }
    children.set(info.id, info)
  }

  removeSession(sessionID: string): void {
    this.childrenByParent.delete(sessionID)
    for (const children of this.childrenByParent.values()) {
      children.delete(sessionID)
    }
  }

  listChildren(parentID: string): ChildSessionInfo[] {
    const children = this.childrenByParent.get(parentID)
    if (!children) return []
    return Array.from(children.values()).sort((a, b) => a.created - b.created)
  }

  lastChild(parentID: string): ChildSessionInfo | undefined {
    const list = this.listChildren(parentID)
    return list.at(-1)
  }
}
