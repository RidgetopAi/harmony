import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/agent-definition.js";
import { EventLog } from "../events/event-log.js";
import { MessageBroker } from "../messages/message-broker.js";
import type { AgentAction, AgentOutput, RuntimeHarness, Task } from "../runtime/runtime-harness.js";
import { ToolBroker } from "../tools/tool-broker.js";
import { TaskRouter } from "./task-router.js";

export class Orchestrator {
  private readonly agentsById: Map<string, AgentDefinition>;

  constructor(
    private readonly agents: AgentDefinition[],
    private readonly router: TaskRouter,
    private readonly harness: RuntimeHarness,
    private readonly toolBroker: ToolBroker,
    private readonly messageBroker: MessageBroker,
    private readonly events: EventLog
  ) {
    this.agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  }

  async run(content: string): Promise<void> {
    const task: Task = {
      id: randomUUID(),
      content
    };

    this.events.record({
      type: "task.created",
      data: { taskId: task.id, content: task.content }
    });

    const agent = this.router.route(task);

    this.events.record({
      type: "task.routed",
      actorId: agent.id,
      data: { taskId: task.id }
    });

    const session = await this.harness.startAgentSession(agent);

    this.events.record({
      type: "agent.session_started",
      actorId: agent.id,
      data: { sessionId: session.id }
    });

    const output = await this.harness.runTask(session, task);
    await this.handleOutput(agent, output, 0);
  }

  private async handleOutput(agent: AgentDefinition, output: AgentOutput, depth: number): Promise<void> {
    this.events.record({
      type: "agent.output",
      actorId: agent.id,
      data: { content: output.content, actions: output.actions }
    });

    if (depth > 2) {
      return;
    }

    for (const action of output.actions) {
      await this.handleAction(agent, action, depth);
    }
  }

  private async handleAction(agent: AgentDefinition, action: AgentAction, depth: number): Promise<void> {
    if (action.type === "tool") {
      await this.toolBroker.execute(agent, action.toolName, action.input);
      return;
    }

    const targetAgent = this.agentsById.get(action.toAgentId);

    if (!targetAgent) {
      this.events.record({
        type: "message.denied",
        actorId: agent.id,
        targetId: action.toAgentId,
        data: { reason: `Unknown target agent: ${action.toAgentId}` }
      });
      return;
    }

    const response = await this.messageBroker.send(agent, targetAgent, action.content);

    if (response) {
      await this.handleOutput(targetAgent, response, depth + 1);
    }
  }
}
