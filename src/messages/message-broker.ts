import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/agent-definition.js";
import type { PolicyDecision } from "../control/policy-engine.js";
import { PolicyEngine } from "../control/policy-engine.js";
import { EventLog } from "../events/event-log.js";
import type {
  HarmonyEventIdentity,
  MessagePolicyEventPayload,
  PolicyDecisionEventPayload
} from "../events/event-types.js";
import type { RuntimeHarness, RuntimeRunResult } from "../runtime/runtime-harness.js";
import type { AgentMessage } from "./message.js";

export type MessageContext = Pick<
  Partial<HarmonyEventIdentity>,
  "businessId" | "sourceId" | "sourceRootId" | "sourceScopeId" | "taskId" | "sessionId" | "correlationId"
>;

export class MessageBroker {
  constructor(
    private readonly policy: PolicyEngine,
    private readonly harness: RuntimeHarness,
    private readonly events: EventLog
  ) {}

  async send(
    fromAgent: AgentDefinition,
    toAgent: AgentDefinition,
    content: string,
    context: MessageContext = {}
  ): Promise<RuntimeRunResult | undefined> {
    const decision = this.policy.canMessage(fromAgent, toAgent.id);
    const eventIdentity = getEventIdentity(context);

    this.events.record({
      type: "policy.decision_recorded",
      actorId: fromAgent.id,
      targetId: toAgent.id,
      ...eventIdentity,
      data: policyEventData(decision, context)
    });

    if (!decision.allowed) {
      this.events.record({
        type: "message.denied",
        actorId: fromAgent.id,
        targetId: toAgent.id,
        ...eventIdentity,
        data: messagePolicyEventData(decision, context)
      });

      return undefined;
    }

    const message: AgentMessage = {
      id: randomUUID(),
      fromAgentId: fromAgent.id,
      toAgentId: toAgent.id,
      content,
      createdAt: new Date()
    };

    this.events.record({
      type: "message.allowed",
      actorId: fromAgent.id,
      targetId: toAgent.id,
      ...eventIdentity,
      data: messagePolicyEventData(decision, context, message.id)
    });

    const session = await this.harness.startAgentSession(toAgent);
    const result = await this.harness.receiveMessage(session, message);

    this.events.record({
      type: "message.delivered",
      actorId: fromAgent.id,
      targetId: toAgent.id,
      ...eventIdentity,
      sessionId: session.id,
      data: {
        messageId: message.id,
        sessionId: session.id,
        status: result.status,
        response: result.status === "completed" ? result.output.content : result.error.message,
        taskId: context.taskId
      }
    });

    return result;
  }
}

function messagePolicyEventData(
  decision: PolicyDecision,
  context: MessageContext,
  messageId?: string
): MessagePolicyEventPayload {
  return {
    ...policyEventData(decision, context),
    messageId
  };
}

function policyEventData(
  decision: PolicyDecision,
  context: MessageContext
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

function getEventIdentity(context: MessageContext): MessageContext {
  return {
    businessId: context.businessId,
    sourceId: context.sourceId,
    sourceRootId: context.sourceRootId,
    sourceScopeId: context.sourceScopeId,
    taskId: context.taskId,
    sessionId: context.sessionId,
    correlationId: context.correlationId
  };
}
