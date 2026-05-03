import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { AgentDefinition } from "../agents/agent-definition.js";
import { PolicyEngine } from "../control/policy-engine.js";
import { EventLog } from "../events/event-log.js";

type StreamCall = {
  context: Context;
};

const spikeAgent: AgentDefinition = {
  id: "pi-core-spike-agent",
  name: "Pi Core Spike Agent",
  role: "Exercises the pi-agent-core loop through Harmony policy.",
  systemPrompt: "Request tools through the runtime. Do not assume authority.",
  model: {
    provider: "local-stub",
    model: "fake-stream"
  },
  allowedTools: ["workspace.note"],
  canTalkTo: [],
  permissions: {
    canReadFiles: false,
    canWriteFiles: false,
    canRunCommands: false,
    requiresApprovalFor: ["shell.exec", "filesystem.write"]
  }
};

const fakeModel: Model<any> = {
  id: "fake-stream",
  name: "Fake Stream",
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

function assistantMessage(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: fakeModel.api,
    provider: fakeModel.provider,
    model: fakeModel.id,
    usage,
    stopReason,
    timestamp: Date.now()
  };
}

function fakeStream(_model: Model<any>, context: Context, _options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const hasToolResults = context.messages.some((message) => message.role === "toolResult");

  queueMicrotask(() => {
    if (!hasToolResults) {
      const message = assistantMessage(
        [
          {
            type: "text",
            text: "I will request one allowed Harmony tool and one blocked shell tool."
          },
          {
            type: "toolCall",
            id: "tool-call-note",
            name: "workspace.note",
            arguments: {
              note: "pi-agent-core can run through Harmony-owned tools."
            }
          },
          {
            type: "toolCall",
            id: "tool-call-shell",
            name: "shell.exec",
            arguments: {
              command: "echo this should be blocked by Harmony policy"
            }
          }
        ],
        "toolUse"
      );

      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "toolUse", message });
      return;
    }

    const toolSummary = context.messages
      .filter((message) => message.role === "toolResult")
      .map((message) => `${message.toolName}:${message.isError ? "blocked" : "ok"}`)
      .join(", ");

    const message = assistantMessage(
      [
        {
          type: "text",
          text: `Tool results received by fake model: ${toolSummary}.`
        }
      ],
      "stop"
    );

    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });

  return stream;
}

const noteSchema = Type.Object({
  note: Type.String()
});

const shellSchema = Type.Object({
  command: Type.String()
});

const workspaceNoteTool: AgentTool<typeof noteSchema, { saved: boolean; note: string }> = {
  name: "workspace.note",
  label: "Workspace Note",
  description: "Record a note in the Harmony workspace event stream.",
  parameters: noteSchema,
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: `Saved note: ${params.note}` }],
    details: {
      saved: true,
      note: params.note
    }
  })
};

const blockedShellTool: AgentTool<typeof shellSchema, never> = {
  name: "shell.exec",
  label: "Shell Exec",
  description: "Dummy shell tool registered only so Harmony policy can block it before execution.",
  parameters: shellSchema,
  execute: async () => {
    throw new Error("shell.exec should have been blocked before execution.");
  }
};

function printPiEvent(event: AgentEvent): void {
  if (event.type === "message_update") {
    return;
  }

  console.log(
    JSON.stringify(
      {
        source: "pi-agent-core",
        type: event.type,
        toolName: "toolName" in event ? event.toolName : undefined,
        isError: "isError" in event ? event.isError : undefined
      },
      null,
      2
    )
  );
}

const policy = new PolicyEngine();
const events = new EventLog();
const streamCalls: StreamCall[] = [];

const agent = new Agent({
  initialState: {
    systemPrompt: spikeAgent.systemPrompt,
    model: fakeModel,
    thinkingLevel: "off",
    tools: [workspaceNoteTool, blockedShellTool]
  },
  streamFn: (model, context, options) => {
    streamCalls.push({ context });
    return fakeStream(model, context, options);
  },
  toolExecution: "sequential",
  beforeToolCall: async ({ toolCall }) => {
    const decision = policy.canUseTool(spikeAgent, toolCall.name);

    if (!decision.allowed) {
      events.record({
        type: "tool.denied",
        actorId: spikeAgent.id,
        data: {
          toolName: toolCall.name,
          decision: decision.decision,
          reason: decision.reason,
          action: decision.action,
          resource: decision.resource,
          policyRuleId: decision.policyRuleId
        }
      });

      return {
        block: true,
        reason: decision.reason
      };
    }

    events.record({
      type: "tool.allowed",
      actorId: spikeAgent.id,
      data: {
        toolName: toolCall.name,
        decision: decision.decision,
        action: decision.action,
        resource: decision.resource,
        policyRuleId: decision.policyRuleId
      }
    });

    return undefined;
  },
  afterToolCall: async ({ toolCall, result, isError }) => {
    events.record({
      type: "tool.completed",
      actorId: spikeAgent.id,
      data: {
        toolName: toolCall.name,
        ok: !isError,
        output: result.content
      }
    });

    return undefined;
  }
});

agent.subscribe((event) => {
  printPiEvent(event);
});

await agent.prompt("Run the Harmony pi-agent-core policy spike.");

console.log(
  JSON.stringify(
    {
      source: "harmony",
      streamCalls: streamCalls.length,
      events: events.list().map((event) => ({
        type: event.type,
        actorId: event.actorId,
        data: event.data
      }))
    },
    null,
    2
  )
);
