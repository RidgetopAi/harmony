import type { AgentDefinition } from "../agents/agent-definition.js";
import type { Task } from "../runtime/runtime-harness.js";

export class TaskRouter {
  constructor(private readonly agents: AgentDefinition[]) {}

  route(_task: Task): AgentDefinition {
    const planner = this.agents.find((agent) => agent.id === "planner");

    if (!planner) {
      throw new Error("No planner agent is configured.");
    }

    return planner;
  }
}
