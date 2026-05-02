import type { AgentDefinition } from "../agents/agent-definition.js";
import type { AgentSession } from "../agents/agent-session.js";
import type { AgentMessage } from "../messages/message.js";

export type Task = {
  id: string;
  content: string;
};

export type AgentAction =
  | {
      type: "tool";
      toolName: string;
      input: unknown;
    }
  | {
      type: "message";
      toAgentId: string;
      content: string;
    };

export type AgentOutput = {
  agentId: string;
  content: string;
  actions: AgentAction[];
};

export interface RuntimeHarness {
  startAgentSession(agent: AgentDefinition): Promise<AgentSession>;
  runTask(session: AgentSession, task: Task): Promise<AgentOutput>;
  receiveMessage(session: AgentSession, message: AgentMessage): Promise<AgentOutput>;
}
