import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_PROTOCOL_FORMAT,
  agentProtocolSchemas,
  parseAgentAction,
  parseAgentOutput,
  parseAgentOutputText
} from "../src/protocol/agent-protocol.js";

test("agent protocol parses simulated model output into typed structured intent", () => {
  const result = parseAgentOutput({
    agentId: "planner",
    content: "I will request a plan note and ask the coder for a review.",
    format: AGENT_PROTOCOL_FORMAT,
    actions: [
      {
        type: "tool",
        toolName: "task.plan.create",
        input: {
          steps: ["define schema", "validate actions"]
        }
      },
      {
        type: "message",
        toAgentId: "coder",
        content: "Review the protocol schema boundary."
      }
    ],
    rawOutput: {
      provider: "simulated-model"
    }
  });

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.equal(result.output.content, "I will request a plan note and ask the coder for a review.");
  assert.equal(result.output.actions.length, 2);
  assert.deepEqual(result.output.actions[0], {
    type: "tool",
    toolName: "task.plan.create",
    input: {
      steps: ["define schema", "validate actions"]
    }
  });
  assert.deepEqual(result.output.actions[1], {
    type: "message",
    toAgentId: "coder",
    content: "Review the protocol schema boundary."
  });
});

test("agent protocol parses model text as JSON structured intent", () => {
  const result = parseAgentOutputText(
    JSON.stringify({
      agentId: "planner",
      content: "Human-readable answer stays in content.",
      format: AGENT_PROTOCOL_FORMAT,
      actions: [
        {
          type: "tool",
          toolName: "workspace.note",
          input: {
            note: "Machine-readable intent stays in actions."
          }
        }
      ]
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.equal(result.output.content, "Human-readable answer stays in content.");
  assert.deepEqual(result.output.actions, [
    {
      type: "tool",
      toolName: "workspace.note",
      input: {
        note: "Machine-readable intent stays in actions."
      }
    }
  ]);
});

test("agent protocol rejects free-form model text", () => {
  assert.deepEqual(parseAgentOutputText("I should run workspace.note now."), {
    ok: false,
    code: "invalid_json",
    reason: "Agent output text must be valid JSON."
  });
});

test("agent protocol rejects malformed action payloads with specific reasons", () => {
  const missingToolName = parseAgentAction({
    type: "tool",
    input: {
      command: "echo should not run"
    }
  });

  assert.deepEqual(missingToolName, {
    ok: false,
    code: "missing_tool_name",
    reason: "tool action must include toolName."
  });

  const malformedOutput = parseAgentOutput({
    agentId: "planner",
    content: "This has a malformed message action.",
    format: AGENT_PROTOCOL_FORMAT,
    actions: [
      {
        type: "message",
        toAgentId: "coder",
        content: 42
      }
    ]
  });

  assert.deepEqual(malformedOutput, {
    ok: false,
    code: "invalid_action",
    actionIndex: 0,
    actionIssue: {
      code: "invalid_message_content"
    },
    reason: "Invalid action at index 0: message action content must be a string."
  });
});

test("agent protocol schemas keep human content separate from machine actions", () => {
  assert.equal(agentProtocolSchemas.output.properties.content.type, "string");
  assert.equal(agentProtocolSchemas.output.properties.actions.type, "array");
  assert.equal(agentProtocolSchemas.toolAction.properties.toolName.type, "string");
  assert.equal(agentProtocolSchemas.messageAction.properties.toAgentId.type, "string");
});
