import type { AgentDefinition } from "../agents/agent-definition.js";
import type { AgentSession } from "../agents/agent-session.js";
import type { AgentMessage } from "../messages/message.js";
import type { AgentOutput, RuntimeHarness, Task } from "./runtime-harness.js";

export class PiMonoHarness implements RuntimeHarness {
  async startAgentSession(_agent: AgentDefinition): Promise<AgentSession> {
    throw new Error("PiMonoHarness is a placeholder. Wire pi-mono here after the control boundary is stable.");
  }

  async runTask(_session: AgentSession, _task: Task): Promise<AgentOutput> {
    throw new Error("PiMonoHarness.runTask is not implemented yet.");
  }

  async receiveMessage(_session: AgentSession, _message: AgentMessage): Promise<AgentOutput> {
    throw new Error("PiMonoHarness.receiveMessage is not implemented yet.");
  }
}
