import { randomUUID } from "node:crypto";
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { AgentDefinition } from "../agents/agent-definition.js";
import type { AgentSession } from "../agents/agent-session.js";
import type { AgentMessage as HarmonyAgentMessage } from "../messages/message.js";
import type {
  AgentAction,
  AgentOutput,
  RuntimeHarness,
  RuntimeOutputMode,
  RuntimeRequestOptions,
  RuntimeRunResult,
  Task
} from "./runtime-harness.js";

export type PiCoreHarnessOptions = {
  model?: Model<any>;
  streamFn?: StreamFn;
};

type SessionRecord = {
  agent: AgentDefinition;
  session: AgentSession;
};

export class PiCoreHarness implements RuntimeHarness {
  private readonly harnessName = "pi-core";
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly model: Model<any>;
  private readonly streamFn: StreamFn;

  constructor(options: PiCoreHarnessOptions = {}) {
    this.model = options.model ?? createFakeModel();
    this.streamFn = options.streamFn ?? fakeStream;
  }

  async startAgentSession(agent: AgentDefinition): Promise<AgentSession> {
    const now = new Date();
    const session: AgentSession = {
      id: randomUUID(),
      agentId: agent.id,
      harnessName: this.harnessName,
      state: "running",
      startedAt: now,
      lastActiveAt: now
    };

    this.sessions.set(session.id, { agent, session });
    return session;
  }

  async receiveMessage(
    session: AgentSession,
    message: HarmonyAgentMessage,
    options?: RuntimeRequestOptions
  ): Promise<RuntimeRunResult> {
    return this.runPrompt(session, `Message from ${message.fromAgentId}: ${message.content}`, options);
  }

  async runTask(
    session: AgentSession,
    task: Task,
    options?: RuntimeRequestOptions
  ): Promise<RuntimeRunResult> {
    return this.runPrompt(session, `Task ${task.id}: ${task.content}`, options);
  }

  private async runPrompt(
    session: AgentSession,
    prompt: string,
    options: RuntimeRequestOptions = {}
  ): Promise<RuntimeRunResult> {
    const startedAt = Date.now();
    const outputMode = options.outputMode ?? "batch";
    const record = this.sessions.get(session.id);

    if (session.state !== "running" || !record) {
      return this.fail(
        session,
        outputMode,
        startedAt,
        "session_not_running",
        `Session ${session.id} is not running.`
      );
    }

    const requestedActions: AgentAction[] = [];
    const piEvents: Array<Record<string, unknown>> = [];
    const piAgent = new Agent({
      initialState: {
        systemPrompt: record.agent.systemPrompt,
        model: this.model,
        thinkingLevel: "off",
        tools: createIntentTools()
      },
      streamFn: this.streamFn,
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall, args }) => {
        requestedActions.push({
          type: "tool",
          toolName: toolCall.name,
          input: args
        });

        return undefined;
      }
    });

    piAgent.subscribe((event) => {
      if (event.type !== "message_update") {
        piEvents.push(summarizePiEvent(event));
      }
    });

    try {
      const run = piAgent.prompt(prompt);
      const timeout = this.createTimeout(session, outputMode, startedAt, options.timeoutMs, piAgent);
      const result = timeout
        ? await Promise.race([run.then(() => undefined), timeout.promise])
        : await run.then(() => undefined);

      if (timeout) {
        clearTimeout(timeout.id);
      }

      if (result) {
        return result;
      }

      session.lastActiveAt = new Date();

      return {
        status: "completed",
        session,
        outputMode,
        durationMs: Date.now() - startedAt,
        output: {
          agentId: session.agentId,
          content: extractAssistantText(piAgent.state.messages),
          format: "structured-intent",
          actions: requestedActions,
          rawOutput: {
            harness: this.harnessName,
            events: piEvents
          }
        }
      };
    } catch (error) {
      return this.fail(
        session,
        outputMode,
        startedAt,
        "runtime_error",
        error instanceof Error ? error.message : "PiCoreHarness runtime error.",
        error
      );
    }
  }

  private createTimeout(
    session: AgentSession,
    outputMode: RuntimeOutputMode,
    startedAt: number,
    timeoutMs: number | undefined,
    agent: Agent
  ): { id: ReturnType<typeof setTimeout>; promise: Promise<RuntimeRunResult> } | undefined {
    if (timeoutMs === undefined) {
      return undefined;
    }

    let id: ReturnType<typeof setTimeout>;
    const promise = new Promise<RuntimeRunResult>((resolve) => {
      id = setTimeout(() => {
        agent.abort();
        resolve(this.fail(session, outputMode, startedAt, "timeout", `Session ${session.id} timed out.`));
      }, timeoutMs);
    });

    return { id: id!, promise };
  }

  private fail(
    session: AgentSession,
    outputMode: RuntimeOutputMode,
    startedAt: number,
    code: "session_not_running" | "timeout" | "runtime_error",
    message: string,
    cause?: unknown
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
        message,
        cause
      }
    };
  }
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};

function createFakeModel(): Model<any> {
  return {
    id: "fake-pi-core-stream",
    name: "Fake Pi Core Stream",
    api: "openai-responses",
    provider: "local-stub",
    baseUrl: "local://fake",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 16_000,
    maxTokens: 1_000
  };
}

function fakeStream(model: Model<any>, context: Context, _options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const hasToolResults = context.messages.some((message) => message.role === "toolResult");

  queueMicrotask(() => {
    if (!hasToolResults) {
      const prompt = getLastUserText(context);
      const isMessagePrompt = prompt.startsWith("Message from ");
      const message = assistantMessage(
        model,
        [
          {
            type: "text",
            text: "I will express tool requests as Harmony intent."
          },
          ...(isMessagePrompt
            ? [
                {
                  type: "toolCall" as const,
                  id: "tool-call-note",
                  name: "workspace.note",
                  arguments: {
                    note: "pi-agent-core output was converted into Harmony intent."
                  }
                }
              ]
            : [
                {
                  type: "toolCall" as const,
                  id: "tool-call-plan",
                  name: "task.plan.create",
                  arguments: {
                    taskId: "pi-core-task",
                    steps: ["capture pi-core tool call", "return Harmony AgentAction intent"]
                  }
                },
                {
                  type: "toolCall" as const,
                  id: "tool-call-shell",
                  name: "shell.exec",
                  arguments: {
                    command: "echo this must still go through Harmony policy"
                  }
                }
              ])
        ],
        "toolUse"
      );

      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "toolUse", message });
      return;
    }

    const toolSummary = context.messages
      .filter((message) => message.role === "toolResult")
      .map((message) => `${message.toolName}:${message.isError ? "blocked" : "captured"}`)
      .join(", ");

    const message = assistantMessage(
      model,
      [
        {
          type: "text",
          text: `Harmony intent captured from pi-agent-core: ${toolSummary}.`
        }
      ],
      "stop"
    );

    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });

  return stream;
}

function assistantMessage(
  model: Model<any>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now()
  };
}

function createIntentTools(): AgentTool<any>[] {
  return [taskPlanIntentTool, workspaceNoteIntentTool, shellExecIntentTool];
}

const taskPlanIntentTool: AgentTool<any, { captured: true }> = {
  name: "task.plan.create",
  label: "Task Plan Create Intent",
  description: "Capture a task planning request as Harmony intent.",
  parameters: Type.Object({
    taskId: Type.String(),
    steps: Type.Array(Type.String())
  }),
  execute: async () => intentToolResult("task.plan.create")
};

const workspaceNoteIntentTool: AgentTool<any, { captured: true }> = {
  name: "workspace.note",
  label: "Workspace Note Intent",
  description: "Capture a workspace note request as Harmony intent.",
  parameters: Type.Object({
    note: Type.String()
  }),
  execute: async () => intentToolResult("workspace.note")
};

const shellExecIntentTool: AgentTool<any, { captured: true }> = {
  name: "shell.exec",
  label: "Shell Exec Intent",
  description: "Capture a shell request as Harmony intent without executing a shell.",
  parameters: Type.Object({
    command: Type.String()
  }),
  execute: async () => intentToolResult("shell.exec")
};

function intentToolResult(toolName: string) {
  return {
    content: [{ type: "text" as const, text: `Captured ${toolName} as Harmony intent.` }],
    details: {
      captured: true as const
    }
  };
}

function extractAssistantText(messages: unknown[]): string {
  const assistantMessages = messages.filter(isAssistantMessage);
  const last = assistantMessages.at(-1);

  if (!last) {
    return "";
  }

  return last.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

function getLastUserText(context: Context): string {
  let lastUser: Context["messages"][number] | undefined;

  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];

    if (message.role === "user") {
      lastUser = message;
      break;
    }
  }

  if (!lastUser) {
    return "";
  }

  if (typeof lastUser.content === "string") {
    return lastUser.content;
  }

  return lastUser.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    value.role === "assistant" &&
    "content" in value &&
    Array.isArray(value.content)
  );
}

function summarizePiEvent(event: AgentEvent): Record<string, unknown> {
  return {
    type: event.type,
    toolName: "toolName" in event ? event.toolName : undefined,
    isError: "isError" in event ? event.isError : undefined
  };
}
