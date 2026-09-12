import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "opencode-froggy.cli",
  setup(context) {
    const location = context.location ?? context.data.location.default()

    const refreshAgents = () => {
      context.data.location.agent.invalidate(location)
      void context.data.location.agent.sync(location).catch(() => {})
    }

    const stopAgents = context.data.on("agent.updated", refreshAgents)
    const stopCommands = context.data.on("command.updated", () => {
      context.data.location.command.invalidate(location)
      void context.data.location.command.sync(location).catch(() => {})
    })

    return () => {
      stopAgents()
      stopCommands()
    }
  },
})
