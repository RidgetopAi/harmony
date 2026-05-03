import type { AgentDefinition } from "../agents/agent-definition.js";
import type { Task } from "../runtime/runtime-harness.js";

export class TaskRouter {
  constructor(private readonly agents: AgentDefinition[]) {}

  route(task: Task): AgentDefinition {
    const agentId = isDiscoveryTask(task) ? "file-discovery-agent" : "planner";
    const selectedAgent = this.agents.find((agent) => agent.id === agentId);

    if (!selectedAgent) {
      throw new Error(`No ${agentId} agent is configured.`);
    }

    return selectedAgent;
  }
}

function isDiscoveryTask(task: Task): boolean {
  return /\b(discover|discovery|scan)\b/i.test(task.content);
}
