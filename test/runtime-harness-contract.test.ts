import assert from "node:assert/strict";
import { test } from "node:test";
import { agents } from "../src/config/agents.js";
import { Orchestrator } from "../src/control/orchestrator.js";
import { PolicyEngine } from "../src/control/policy-engine.js";
import { TaskRouter } from "../src/control/task-router.js";
import { EventLog } from "../src/events/event-log.js";
import { MessageBroker } from "../src/messages/message-broker.js";
import { LocalHarness } from "../src/runtime/local-harness.js";
import { PiCoreHarness } from "../src/runtime/pi-core-harness.js";
import type { RuntimeHarness, RuntimeRunResult, Task } from "../src/runtime/runtime-harness.js";
import { ToolBroker } from "../src/tools/tool-broker.js";
import { ToolRegistry } from "../src/tools/tool-registry.js";
import type { AgentDefinition } from "../src/agents/agent-definition.js";
import type { AgentSession } from "../src/agents/agent-session.js";
import type { AgentMessage } from "../src/messages/message.js";

test("LocalHarness returns completed batch results with structured agent intent", async () => {
  const harness = new LocalHarness();
  const planner = agents.find((agent) => agent.id === "planner");

  assert.ok(planner);

  const session = await harness.startAgentSession(planner);
  const result = await harness.runTask(session, {
    id: "task-1",
    content: "Exercise the runtime contract."
  });

  assert.equal(session.harnessName, "local");
  assert.equal(session.state, "running");
  assert.equal(result.status, "completed");
  assert.equal(result.outputMode, "batch");
  assert.equal(result.output.format, "structured-intent");
  assert.equal(result.output.agentId, "planner");
  assert.ok(result.output.actions.some((action) => action.type === "tool" && action.toolName === "shell.exec"));
});

test("LocalHarness returns timed_out when runtime work exceeds timeoutMs", async () => {
  const harness = new LocalHarness({ responseDelayMs: 15 });
  const planner = agents.find((agent) => agent.id === "planner");

  assert.ok(planner);

  const session = await harness.startAgentSession(planner);
  const result = await harness.runTask(
    session,
    {
      id: "task-timeout",
      content: "Exercise timeout behavior."
    },
    {
      timeoutMs: 1
    }
  );

  assert.equal(result.status, "timed_out");
  assert.equal(result.session.state, "timed_out");
  assert.equal(result.error.code, "timeout");
});

test("PiCoreHarness returns pi-agent-core tool calls as structured Harmony intent", async () => {
  const harness = new PiCoreHarness();
  const planner = agents.find((agent) => agent.id === "planner");

  assert.ok(planner);

  const session = await harness.startAgentSession(planner);
  const result = await harness.runTask(session, {
    id: "task-pi-core",
    content: "Exercise pi-core runtime contract."
  });

  assert.equal(session.harnessName, "pi-core");
  assert.equal(result.status, "completed");
  assert.equal(result.output.format, "structured-intent");
  assert.equal(result.output.agentId, "planner");
  assert.ok(result.output.actions.some((action) => action.type === "tool" && action.toolName === "task.plan.create"));
  assert.ok(result.output.actions.some((action) => action.type === "tool" && action.toolName === "shell.exec"));
});

test("LocalHarness tool intent is brokered through policy before any tool handler runs", async () => {
  await assertHarnessToolIntentIsBrokered(new LocalHarness());
});

test("PiCoreHarness tool intent is brokered through policy before any tool handler runs", async () => {
  await assertHarnessToolIntentIsBrokered(new PiCoreHarness());
});

async function assertHarnessToolIntentIsBrokered(harness: RuntimeHarness): Promise<void> {
  let shellExecCalled = false;
  const events = new EventLog();
  const policy = new PolicyEngine();
  const registry = new ToolRegistry();

  registry.register("task.plan.create", (input) => ({
    ok: true,
    output: { created: true, input }
  }));

  registry.register("workspace.note", (input) => ({
    ok: true,
    output: { saved: true, input }
  }));

  registry.register("shell.exec", () => {
    shellExecCalled = true;
    return {
      ok: true,
      output: "shell should never execute in this test"
    };
  });

  const router = new TaskRouter(agents);
  const toolBroker = new ToolBroker(policy, registry, events);
  const messageBroker = new MessageBroker(policy, harness, events);
  const orchestrator = new Orchestrator(agents, router, harness, toolBroker, messageBroker, events);

  await orchestrator.run("Prove harness output cannot bypass policy.");

  const savedEvents = events.list();

  assert.equal(shellExecCalled, false);
  assert.ok(
    savedEvents.some(
      (event) => event.type === "tool.denied" && event.data.toolName === "shell.exec"
    )
  );
  assert.equal(
    savedEvents.some(
      (event) => event.type === "tool.completed" && event.data.toolName === "shell.exec"
    ),
    false
  );
}

test("malformed completed harness output is rejected before actions can run", async () => {
  let shellExecCalled = false;
  const events = new EventLog();
  const policy = new PolicyEngine();
  const harness = new MalformedOutputHarness();
  const registry = new ToolRegistry();

  registry.register("shell.exec", () => {
    shellExecCalled = true;
    return {
      ok: true,
      output: "shell should never execute from malformed output"
    };
  });

  const router = new TaskRouter(agents);
  const toolBroker = new ToolBroker(policy, registry, events);
  const messageBroker = new MessageBroker(policy, harness, events);
  const orchestrator = new Orchestrator(agents, router, harness, toolBroker, messageBroker, events);

  await orchestrator.run("Reject malformed harness output.");

  const savedEvents = events.list();

  assert.equal(shellExecCalled, false);
  assert.equal(savedEvents.some((event) => event.type === "agent.output"), false);
  assert.equal(savedEvents.some((event) => event.type === "tool.allowed"), false);
  assert.ok(
    savedEvents.some(
      (event) =>
        event.type === "agent.run_failed" &&
        isRecord(event.data.error) &&
        event.data.error.code === "invalid_output"
    )
  );
});

test("malformed action payloads are logged as invalid before broker execution", async () => {
  let shellExecCalled = false;
  const events = new EventLog();
  const policy = new PolicyEngine();
  const harness = new MalformedActionHarness();
  const registry = new ToolRegistry();

  registry.register("shell.exec", () => {
    shellExecCalled = true;
    return {
      ok: true,
      output: "shell should never execute from malformed action"
    };
  });

  const router = new TaskRouter(agents);
  const toolBroker = new ToolBroker(policy, registry, events);
  const messageBroker = new MessageBroker(policy, harness, events);
  const orchestrator = new Orchestrator(agents, router, harness, toolBroker, messageBroker, events);

  await orchestrator.run("Reject malformed action payload.");

  const savedEvents = events.list();

  assert.equal(shellExecCalled, false);
  assert.equal(savedEvents.some((event) => event.type === "agent.output"), false);
  assert.equal(savedEvents.some((event) => event.type === "tool.allowed"), false);
  assert.equal(savedEvents.some((event) => event.type === "tool.completed"), false);
  assert.equal(savedEvents.some((event) => event.type === "message.delivered"), false);
  assert.ok(
    savedEvents.some(
      (event) =>
        event.type === "agent.action_invalid" &&
        event.data.actionIndex === 0 &&
        isRecord(event.data.actionIssue) &&
        event.data.actionIssue.code === "missing_tool_name"
    )
  );
  assert.ok(
    savedEvents.some(
      (event) =>
        event.type === "agent.run_failed" &&
        isRecord(event.data.error) &&
        event.data.error.code === "invalid_output" &&
        event.data.error.validationCode === "invalid_action"
    )
  );
});

class MalformedOutputHarness implements RuntimeHarness {
  async startAgentSession(agent: AgentDefinition): Promise<AgentSession> {
    const now = new Date();

    return {
      id: "malformed-session",
      agentId: agent.id,
      harnessName: "malformed-test",
      state: "running",
      startedAt: now,
      lastActiveAt: now
    };
  }

  async runTask(_session: AgentSession, _task: Task): Promise<RuntimeRunResult> {
    return {
      status: "completed",
      session: _session,
      outputMode: "batch",
      durationMs: 0,
      output: {
        agentId: "planner",
        content: "This output is missing the required structured-intent format.",
        actions: [
          {
            type: "tool",
            toolName: "shell.exec",
            input: {
              command: "echo malformed output should not run"
            }
          }
        ]
      }
    } as unknown as RuntimeRunResult;
  }

  async receiveMessage(_session: AgentSession, _message: AgentMessage): Promise<RuntimeRunResult> {
    throw new Error("MalformedOutputHarness.receiveMessage is not used in this test.");
  }
}

class MalformedActionHarness implements RuntimeHarness {
  async startAgentSession(agent: AgentDefinition): Promise<AgentSession> {
    const now = new Date();

    return {
      id: "malformed-action-session",
      agentId: agent.id,
      harnessName: "malformed-action-test",
      state: "running",
      startedAt: now,
      lastActiveAt: now
    };
  }

  async runTask(_session: AgentSession, _task: Task): Promise<RuntimeRunResult> {
    return {
      status: "completed",
      session: _session,
      outputMode: "batch",
      durationMs: 0,
      output: {
        agentId: "planner",
        content: "This output has structured-intent format but a malformed action.",
        format: "structured-intent",
        actions: [
          {
            type: "tool",
            input: {
              command: "echo malformed action should not run"
            }
          }
        ]
      }
    } as unknown as RuntimeRunResult;
  }

  async receiveMessage(_session: AgentSession, _message: AgentMessage): Promise<RuntimeRunResult> {
    throw new Error("MalformedActionHarness.receiveMessage is not used in this test.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
