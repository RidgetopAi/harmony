import type { AgentDefinition } from "../agents/agent-definition.js";
import { EventLog } from "../events/event-log.js";
import { PolicyEngine } from "../control/policy-engine.js";
import { ToolRegistry, type ToolResult } from "./tool-registry.js";

export class ToolBroker {
  constructor(
    private readonly policy: PolicyEngine,
    private readonly registry: ToolRegistry,
    private readonly events: EventLog
  ) {}

  async execute(agent: AgentDefinition, toolName: string, input: unknown): Promise<ToolResult> {
    const decision = this.policy.canUseTool(agent, toolName);

    if (!decision.allowed) {
      this.events.record({
        type: "tool.denied",
        actorId: agent.id,
        data: { toolName, reason: decision.reason }
      });

      return {
        ok: false,
        output: decision.reason
      };
    }

    this.events.record({
      type: "tool.allowed",
      actorId: agent.id,
      data: { toolName }
    });

    const result = await this.registry.execute(toolName, input);

    this.events.record({
      type: "tool.completed",
      actorId: agent.id,
      data: { toolName, ok: result.ok, output: result.output }
    });

    return result;
  }
}
