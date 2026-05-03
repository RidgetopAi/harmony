import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/agent-definition.js";
import type { AgentSession } from "../agents/agent-session.js";
import type { AgentMessage } from "../messages/message.js";
import type {
  AgentOutput,
  RuntimeHarness,
  RuntimeOutputMode,
  RuntimeRequestOptions,
  RuntimeRunResult,
  Task
} from "./runtime-harness.js";

export type LocalHarnessOptions = {
  responseDelayMs?: number;
};

export class LocalHarness implements RuntimeHarness {
  private readonly harnessName = "local";

  constructor(private readonly options: LocalHarnessOptions = {}) {}

  async startAgentSession(agent: AgentDefinition): Promise<AgentSession> {
    const now = new Date();

    return {
      id: randomUUID(),
      agentId: agent.id,
      harnessName: this.harnessName,
      state: "running",
      startedAt: now,
      lastActiveAt: now
    };
  }

  async runTask(
    session: AgentSession,
    task: Task,
    options: RuntimeRequestOptions = {}
  ): Promise<RuntimeRunResult> {
    const startedAt = Date.now();
    const outputMode = options.outputMode ?? "batch";

    if (session.state !== "running") {
      return this.fail(
        session,
        outputMode,
        startedAt,
        "session_not_running",
        `Session ${session.id} is not running.`
      );
    }

    const timeout = this.timeoutIfExpired(session, outputMode, startedAt, options.timeoutMs);

    if (timeout) {
      return timeout;
    }

    await this.delayIfConfigured();

    const delayedTimeout = this.timeoutIfExpired(session, outputMode, startedAt, options.timeoutMs);

    if (delayedTimeout) {
      return delayedTimeout;
    }

    if (session.agentId === "planner") {
      return this.complete(session, outputMode, startedAt, {
        agentId: session.agentId,
        content: `Planner decomposed task: ${task.content}`,
        format: "structured-intent",
        actions: [
          {
            type: "tool",
            toolName: "task.plan.create",
            input: {
              taskId: task.id,
              steps: ["define control boundary", "ask coder for runtime adapter shape"]
            }
          },
          {
            type: "message",
            toAgentId: "coder",
            content: "Sketch the smallest RuntimeHarness adapter boundary."
          },
          {
            type: "tool",
            toolName: "shell.exec",
            input: {
              command: "echo planner should not be able to run this"
            }
          }
        ]
      });
    }

    return this.complete(session, outputMode, startedAt, {
      agentId: session.agentId,
      content: `${session.agentId} received task: ${task.content}`,
      format: "structured-intent",
      actions: []
    });
  }

  async receiveMessage(
    session: AgentSession,
    message: AgentMessage,
    options: RuntimeRequestOptions = {}
  ): Promise<RuntimeRunResult> {
    const startedAt = Date.now();
    const outputMode = options.outputMode ?? "batch";

    if (session.state !== "running") {
      return this.fail(
        session,
        outputMode,
        startedAt,
        "session_not_running",
        `Session ${session.id} is not running.`
      );
    }

    const timeout = this.timeoutIfExpired(session, outputMode, startedAt, options.timeoutMs);

    if (timeout) {
      return timeout;
    }

    await this.delayIfConfigured();

    const delayedTimeout = this.timeoutIfExpired(session, outputMode, startedAt, options.timeoutMs);

    if (delayedTimeout) {
      return delayedTimeout;
    }

    if (session.agentId === "coder") {
      return this.complete(session, outputMode, startedAt, {
        agentId: session.agentId,
        content: `Coder received message from ${message.fromAgentId}`,
        format: "structured-intent",
        actions: [
          {
            type: "tool",
            toolName: "workspace.note",
            input: {
              note: "RuntimeHarness should hide pi-agent-core behind startAgentSession/runTask/receiveMessage."
            }
          }
        ]
      });
    }

    return this.complete(session, outputMode, startedAt, {
      agentId: session.agentId,
      content: `${session.agentId} received message: ${message.content}`,
      format: "structured-intent",
      actions: []
    });
  }

  private complete(
    session: AgentSession,
    outputMode: RuntimeOutputMode,
    startedAt: number,
    output: AgentOutput
  ): RuntimeRunResult {
    session.lastActiveAt = new Date();

    return {
      status: "completed",
      session,
      outputMode,
      durationMs: Date.now() - startedAt,
      output
    };
  }

  private fail(
    session: AgentSession,
    outputMode: RuntimeOutputMode,
    startedAt: number,
    code: "session_not_running" | "timeout",
    message: string
  ): RuntimeRunResult {
    const now = new Date();
    session.state = code === "timeout" ? "timed_out" : "failed";
    session.lastActiveAt = now;
    session.endedAt = now;

    return {
      status: code === "timeout" ? "timed_out" : "failed",
      session,
      outputMode,
      durationMs: Date.now() - startedAt,
      error: {
        code,
        message
      }
    };
  }

  private timeoutIfExpired(
    session: AgentSession,
    outputMode: RuntimeOutputMode,
    startedAt: number,
    timeoutMs: number | undefined
  ): RuntimeRunResult | undefined {
    if (timeoutMs === undefined || Date.now() - startedAt < timeoutMs) {
      return undefined;
    }

    return this.fail(session, outputMode, startedAt, "timeout", `Session ${session.id} timed out.`);
  }

  private async delayIfConfigured(): Promise<void> {
    if (!this.options.responseDelayMs) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, this.options.responseDelayMs));
  }
}
