import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/agent-definition.js";
import { PolicyEngine } from "../control/policy-engine.js";
import { EventLog } from "../events/event-log.js";
import type { RuntimeHarness, RuntimeRunResult } from "../runtime/runtime-harness.js";
import type { AgentMessage } from "./message.js";

export class MessageBroker {
  constructor(
    private readonly policy: PolicyEngine,
    private readonly harness: RuntimeHarness,
    private readonly events: EventLog
  ) {}

  async send(
    fromAgent: AgentDefinition,
    toAgent: AgentDefinition,
    content: string
  ): Promise<RuntimeRunResult | undefined> {
    const decision = this.policy.canMessage(fromAgent, toAgent.id);

    if (!decision.allowed) {
      this.events.record({
        type: "message.denied",
        actorId: fromAgent.id,
        targetId: toAgent.id,
        data: { reason: decision.reason }
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
      data: { messageId: message.id }
    });

    const session = await this.harness.startAgentSession(toAgent);
    const result = await this.harness.receiveMessage(session, message);

    this.events.record({
      type: "message.delivered",
      actorId: fromAgent.id,
      targetId: toAgent.id,
      data: {
        messageId: message.id,
        sessionId: session.id,
        status: result.status,
        response: result.status === "completed" ? result.output.content : result.error.message
      }
    });

    return result;
  }
}
