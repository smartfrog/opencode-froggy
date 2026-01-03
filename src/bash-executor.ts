import { spawn } from "node:child_process"

export interface BashContext {
  session_id: string
  event: string
  cwd: string
  files?: string[]
  tool_name?: string
  tool_args?: Record<string, unknown>
}

export interface BashResult {
  exitCode: number
  stdout: string
  stderr: string
}

export const DEFAULT_BASH_TIMEOUT = 60000

export function executeBashAction(
  command: string,
  timeout: number,
  context: BashContext,
  projectDir: string
): Promise<BashResult> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      OPENCODE_PROJECT_DIR: projectDir,
      OPENCODE_SESSION_ID: context.session_id,
    }

    const child = spawn("bash", ["-c", command], {
      cwd: context.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      child.kill("SIGTERM")
    }, timeout)

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    child.stdin.on("error", () => {})
    child.stdin.write(JSON.stringify(context))
    child.stdin.end()

    child.on("close", (code) => {
      clearTimeout(timer)
      if (killed) {
        resolve({ exitCode: 1, stdout, stderr: `Command timed out after ${timeout}ms` })
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr })
      }
    })

    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ exitCode: 1, stdout, stderr: err.message })
    })
  })
}
