import type { AgentDefinition } from "../agents/agent-definition.js";
import type { PolicyDecision } from "../control/policy-engine.js";
import { EventLog } from "../events/event-log.js";
import type {
  HarmonyEventIdentity,
  PolicyDecisionEventPayload,
  ToolEventPayload
} from "../events/event-types.js";
import { PolicyEngine } from "../control/policy-engine.js";
import { ToolRegistry, type ToolResult } from "./tool-registry.js";

export type ToolExecutionContext = Pick<
  Partial<HarmonyEventIdentity>,
  "businessId" | "sourceId" | "sourceRootId" | "sourceScopeId" | "taskId" | "sessionId" | "correlationId"
>;

export class ToolBroker {
  constructor(
    private readonly policy: PolicyEngine,
    private readonly registry: ToolRegistry,
    private readonly events: EventLog
  ) {}

  async execute(
    agent: AgentDefinition,
    toolName: string,
    input: unknown,
    context: ToolExecutionContext = {}
  ): Promise<ToolResult> {
    const decision = this.policy.canUseTool(agent, toolName, { input, businessId: context.businessId });
    const eventIdentity = getEventIdentity(context);

    this.events.record({
      type: "policy.decision_recorded",
      actorId: agent.id,
      ...eventIdentity,
      data: policyEventData(decision, context)
    });

    if (decision.decision === "approval_required") {
      this.events.record({
        type: "tool.approval_required",
        actorId: agent.id,
        ...eventIdentity,
        data: toolPolicyEventData(toolName, decision, context)
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
        ...eventIdentity,
        data: toolPolicyEventData(toolName, decision, context)
      });

      return {
        ok: false,
        output: decision.reason
      };
    }

    this.events.record({
      type: "tool.allowed",
      actorId: agent.id,
      ...eventIdentity,
      data: toolPolicyEventData(toolName, decision, context)
    });

    const result = await this.registry.execute(toolName, input);

    this.events.record({
      type: "tool.completed",
      actorId: agent.id,
      ...eventIdentity,
      data: {
        toolName,
        ok: result.ok,
        output: result.output,
        ...getBusinessSourceData(context)
      }
    });

    return result;
  }
}

function toolPolicyEventData(
  toolName: string,
  decision: PolicyDecision,
  context: ToolExecutionContext
): ToolEventPayload {
  return {
    toolName,
    ...policyEventData(decision, context)
  };
}

function policyEventData(
  decision: PolicyDecision,
  context: ToolExecutionContext
): PolicyDecisionEventPayload {
  return {
    decision: decision.decision,
    reason: decision.reason,
    action: decision.action,
    resource: decision.resource,
    policyRuleId: decision.policyRuleId,
    businessId: context.businessId ?? decision.businessId,
    sourceId: context.sourceId,
    sourceRootId: context.sourceRootId,
    sourceScopeId: context.sourceScopeId
  };
}

function getEventIdentity(context: ToolExecutionContext): ToolExecutionContext {
  return {
    ...getBusinessSourceData(context),
    taskId: context.taskId,
    sessionId: context.sessionId,
    correlationId: context.correlationId
  };
}

function getBusinessSourceData(context: ToolExecutionContext): Pick<
  ToolExecutionContext,
  "businessId" | "sourceId" | "sourceRootId" | "sourceScopeId"
> {
  return {
    businessId: context.businessId,
    sourceId: context.sourceId,
    sourceRootId: context.sourceRootId,
    sourceScopeId: context.sourceScopeId
  };
}
