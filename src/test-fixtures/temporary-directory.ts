import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function createTemporaryDirectory(prefix: string, preferredRoot = "/tmp/opencode"): string {
  return mkdtempSync(join(existsSync(preferredRoot) ? preferredRoot : tmpdir(), prefix))
}
