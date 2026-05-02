import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../agents/agent-definition.js";
import type { AgentSession } from "../agents/agent-session.js";
import type { AgentMessage } from "../messages/message.js";
import type { AgentOutput, RuntimeHarness, Task } from "./runtime-harness.js";

export class LocalHarness implements RuntimeHarness {
  async startAgentSession(agent: AgentDefinition): Promise<AgentSession> {
    return {
      id: randomUUID(),
      agentId: agent.id,
      startedAt: new Date()
    };
  }

  async runTask(session: AgentSession, task: Task): Promise<AgentOutput> {
    if (session.agentId === "planner") {
      return {
        agentId: session.agentId,
        content: `Planner decomposed task: ${task.content}`,
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
      };
    }

    return {
      agentId: session.agentId,
      content: `${session.agentId} received task: ${task.content}`,
      actions: []
    };
  }

  async receiveMessage(session: AgentSession, message: AgentMessage): Promise<AgentOutput> {
    if (session.agentId === "coder") {
      return {
        agentId: session.agentId,
        content: `Coder received message from ${message.fromAgentId}`,
        actions: [
          {
            type: "tool",
            toolName: "workspace.note",
            input: {
              note: "RuntimeHarness should hide pi-mono behind startAgentSession/runTask/receiveMessage."
            }
          }
        ]
      };
    }

    return {
      agentId: session.agentId,
      content: `${session.agentId} received message: ${message.content}`,
      actions: []
    };
  }
}
