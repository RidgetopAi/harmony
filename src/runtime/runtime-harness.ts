import type { AgentDefinition } from "../agents/agent-definition.js";
import type { AgentSession } from "../agents/agent-session.js";
import type { AgentMessage } from "../messages/message.js";
import type { AgentOutput } from "../protocol/agent-protocol.js";

export type { AgentAction, AgentOutput } from "../protocol/agent-protocol.js";

export type Task = {
  id: string;
  content: string;
};

export type RuntimeOutputMode = "batch" | "stream";

export type RuntimeRequestOptions = {
  timeoutMs?: number;
  outputMode?: RuntimeOutputMode;
};

export type RuntimeErrorCode =
  | "session_not_running"
  | "timeout"
  | "runtime_error"
  | "invalid_output";

export type RuntimeError = {
  code: RuntimeErrorCode;
  message: string;
  cause?: unknown;
};

export type RuntimeRunResult =
  | {
      status: "completed";
      session: AgentSession;
      outputMode: RuntimeOutputMode;
      durationMs: number;
      output: AgentOutput;
    }
  | {
      status: "failed" | "timed_out";
      session: AgentSession;
      outputMode: RuntimeOutputMode;
      durationMs: number;
      error: RuntimeError;
    };

export interface RuntimeHarness {
  startAgentSession(agent: AgentDefinition): Promise<AgentSession>;
  runTask(session: AgentSession, task: Task, options?: RuntimeRequestOptions): Promise<RuntimeRunResult>;
  receiveMessage(
    session: AgentSession,
    message: AgentMessage,
    options?: RuntimeRequestOptions
  ): Promise<RuntimeRunResult>;
}
