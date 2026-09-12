// OpenCode V2 resolves a local directory plugin through a root `server.*`
// or `index.*` entrypoint, so this file forwards to the real implementation.
export { default } from "./src/index"
