import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/agent-definition.js";
import type { HarmonyEventIdentity } from "../events/event-types.js";
import { EventLog } from "../events/event-log.js";
import { MessageBroker } from "../messages/message-broker.js";
import { validateAgentOutput } from "../runtime/agent-output-validator.js";
import type {
  AgentAction,
  AgentOutput,
  RuntimeHarness,
  RuntimeRunResult,
  Task
} from "../runtime/runtime-harness.js";
import { ToolBroker } from "../tools/tool-broker.js";
import { TaskRouter } from "./task-router.js";

type OrchestratorEventContext = Pick<
  Partial<HarmonyEventIdentity>,
  "taskId" | "sessionId" | "businessId" | "sourceId" | "sourceRootId" | "sourceScopeId" | "correlationId"
>;

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
      taskId: task.id,
      sessionId: session.id,
      data: {
        sessionId: session.id,
        harnessName: session.harnessName,
        state: session.state,
        taskId: task.id
      }
    });

    const result = await this.harness.runTask(session, task);
    await this.handleRunResult(agent, result, 0, { taskId: task.id, sessionId: session.id });
  }

  async handleRunResult(
    agent: AgentDefinition,
    result: RuntimeRunResult,
    depth: number,
    context: OrchestratorEventContext = {}
  ): Promise<void> {
    if (result.status !== "completed") {
      this.events.record({
        type: "agent.run_failed",
        actorId: agent.id,
        ...context,
        data: {
          sessionId: result.session.id,
          status: result.status,
          outputMode: result.outputMode,
          durationMs: result.durationMs,
          error: result.error,
          taskId: context.taskId
        }
      });
      return;
    }

    const validation = validateAgentOutput(result.output);

    if (!validation.ok) {
      if (validation.code === "invalid_action") {
        this.events.record({
          type: "agent.action_invalid",
          actorId: agent.id,
          ...context,
          data: {
            sessionId: result.session.id,
            status: "invalid",
            actionIndex: validation.actionIndex,
            actionIssue: validation.actionIssue,
            reason: validation.reason,
            outputMode: result.outputMode,
            durationMs: result.durationMs,
            rawOutput: result.output.rawOutput ?? result.output,
            taskId: context.taskId
          }
        });
      }

      this.events.record({
        type: "agent.run_failed",
        actorId: agent.id,
        ...context,
        data: {
          sessionId: result.session.id,
          status: "failed",
          outputMode: result.outputMode,
          durationMs: result.durationMs,
          error: {
            code: "invalid_output",
            message: validation.reason,
            validationCode: validation.code
          },
          rawOutput: result.output.rawOutput ?? result.output,
          taskId: context.taskId
        }
      });
      return;
    }

    await this.handleOutput(
      agent,
      validation.output,
      depth,
      {
        ...context,
        sessionId: result.session.id
      }
    );
  }

  private async handleOutput(
    agent: AgentDefinition,
    output: AgentOutput,
    depth: number,
    context: OrchestratorEventContext
  ): Promise<void> {
    this.events.record({
      type: "agent.output",
      actorId: agent.id,
      ...context,
      data: {
        content: output.content,
        actions: output.actions,
        format: output.format,
        rawOutput: output.rawOutput,
        sessionId: context.sessionId,
        taskId: context.taskId
      }
    });

    if (depth > 2) {
      return;
    }

    for (const action of output.actions) {
      await this.handleAction(agent, action, depth, context);
    }
  }

  private async handleAction(
    agent: AgentDefinition,
    action: AgentAction,
    depth: number,
    context: OrchestratorEventContext
  ): Promise<void> {
    if (action.type === "tool") {
      await this.toolBroker.execute(agent, action.toolName, action.input, context);
      return;
    }

    const targetAgent = this.agentsById.get(action.toAgentId);

    if (!targetAgent) {
      this.events.record({
        type: "message.denied",
        actorId: agent.id,
        targetId: action.toAgentId,
        ...context,
        data: { reason: `Unknown target agent: ${action.toAgentId}` }
      });
      return;
    }

    const response = await this.messageBroker.send(agent, targetAgent, action.content, context);

    if (response) {
      await this.handleRunResult(targetAgent, response, depth + 1, {
        ...context,
        sessionId: response.session.id
      });
    }
  }
}
