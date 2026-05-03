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
    const decision = this.policy.canUseTool(agent, toolName, { input });

    if (decision.decision === "approval_required") {
      this.events.record({
        type: "tool.approval_required",
        actorId: agent.id,
        data: {
          toolName,
          decision: decision.decision,
          reason: decision.reason,
          action: decision.action,
          resource: decision.resource,
          policyRuleId: decision.policyRuleId
        }
      });

      return {
        ok: false,
        output: decision.reason
      };
    }

    if (!decision.allowed) {
      this.events.record({
        type: "tool.denied",
        actorId: agent.id,
        data: {
          toolName,
          decision: decision.decision,
          reason: decision.reason,
          action: decision.action,
          resource: decision.resource,
          policyRuleId: decision.policyRuleId
        }
      });

      return {
        ok: false,
        output: decision.reason
      };
    }

    this.events.record({
      type: "tool.allowed",
      actorId: agent.id,
      data: {
        toolName,
        decision: decision.decision,
        action: decision.action,
        resource: decision.resource,
        policyRuleId: decision.policyRuleId
      }
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
