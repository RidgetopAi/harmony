import type { AgentDefinition } from "../agents/agent-definition.js";

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export class PolicyEngine {
  canUseTool(agent: AgentDefinition, toolName: string): PolicyDecision {
    if (!agent.allowedTools.includes(toolName) && !agent.allowedTools.includes("*")) {
      return {
        allowed: false,
        reason: `${agent.id} is not allowed to use ${toolName}`
      };
    }

    if (toolName.startsWith("shell.") && !agent.permissions.canRunCommands) {
      return {
        allowed: false,
        reason: `${agent.id} cannot run shell commands`
      };
    }

    if (toolName.startsWith("filesystem.write") && !agent.permissions.canWriteFiles) {
      return {
        allowed: false,
        reason: `${agent.id} cannot write files`
      };
    }

    if (toolName.startsWith("filesystem.read") && !agent.permissions.canReadFiles) {
      return {
        allowed: false,
        reason: `${agent.id} cannot read files`
      };
    }

    return { allowed: true };
  }

  canMessage(agent: AgentDefinition, targetAgentId: string): PolicyDecision {
    if (!agent.canTalkTo.includes(targetAgentId)) {
      return {
        allowed: false,
        reason: `${agent.id} cannot message ${targetAgentId}`
      };
    }

    return { allowed: true };
  }
}
