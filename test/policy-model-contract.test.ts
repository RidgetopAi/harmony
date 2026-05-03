import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentDefinition, AgentResourceScope } from "../src/agents/agent-definition.js";
import {
  getCapabilityNamespace,
  getToolRiskLevel,
  PolicyEngine
} from "../src/control/policy-engine.js";
import { EventLog } from "../src/events/event-log.js";
import { ToolBroker } from "../src/tools/tool-broker.js";
import { ToolRegistry } from "../src/tools/tool-registry.js";

test("policy derives capability namespaces from tool names", () => {
  assert.equal(getCapabilityNamespace("filesystem.readFile"), "filesystem.read");
  assert.equal(getCapabilityNamespace("filesystem.writeFile"), "filesystem.write");
  assert.equal(getCapabilityNamespace("shell.exec"), "shell.exec");
  assert.equal(getCapabilityNamespace("git.diff"), "git.diff");
  assert.equal(getCapabilityNamespace("task.plan.create"), "task.plan");
  assert.equal(getCapabilityNamespace("shell.executionPlan"), "shell.executionPlan");
});

test("policy derives tool risk levels from capability namespaces", () => {
  assert.equal(getToolRiskLevel("shell.exec"), "critical");
  assert.equal(getToolRiskLevel("filesystem.writeFile"), "high");
  assert.equal(getToolRiskLevel("filesystem.readFile"), "medium");
  assert.equal(getToolRiskLevel("git.diff"), "low");
  assert.equal(getToolRiskLevel("workspace.note"), "low");
});

test("policy allows exact tool grants and returns an explainable decision", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({ allowedTools: ["task.plan.create"] });

  const decision = policy.canUseTool(agent, "task.plan.create");

  assert.equal(decision.decision, "allowed");
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "policy-test-agent can use task.plan.create");
  assert.equal(decision.agentId, "policy-test-agent");
  assert.deepEqual(decision.action, {
    type: "tool",
    name: "task.plan.create",
    capability: "task.plan",
    riskLevel: "low"
  });
  assert.deepEqual(decision.resource, {
    type: "tool",
    name: "task.plan.create",
    capability: "task.plan",
    riskLevel: "low"
  });
});

test("policy allows capability namespace grants across concrete tool names", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["filesystem.read"],
    permissions: { canReadFiles: true },
    resourceScopes: [{ type: "filesystem.path", path: "/business/docs", access: "read" }]
  });

  const decision = policy.canUseTool(agent, "filesystem.readFile", {
    input: { path: "/business/docs/invoice.txt" }
  });

  assert.equal(decision.decision, "allowed");
  assert.equal(decision.allowed, true);
  assert.equal(decision.action.type, "tool");
  assert.equal(decision.action.capability, "filesystem.read");
  assert.equal(decision.action.riskLevel, "medium");
  assert.equal(decision.resource.type, "tool");
  assert.equal(decision.resource.path, "/business/docs/invoice.txt");
});

test("policy denies tools outside the agent allowlist with rule metadata", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({ allowedTools: ["workspace.note"] });

  const decision = policy.canUseTool(agent, "shell.exec");

  assert.equal(decision.decision, "denied");
  assert.equal(decision.allowed, false);
  assert.equal(decision.policyRuleId, "tool.allowlist");
  assert.equal(decision.agentId, "policy-test-agent");
  assert.equal(decision.reason, "policy-test-agent is not allowed to use shell.exec (shell.exec)");
  assert.deepEqual(decision.resource, {
    type: "tool",
    name: "shell.exec",
    capability: "shell.exec",
    riskLevel: "critical"
  });
});

test("policy denies capability grants when permission gates fail", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["filesystem.write"],
    permissions: { canWriteFiles: false }
  });

  const decision = policy.canUseTool(agent, "filesystem.writeFile");

  assert.equal(decision.decision, "denied");
  assert.equal(decision.allowed, false);
  assert.equal(decision.policyRuleId, "permission.filesystem.write");
  assert.equal(decision.reason, "policy-test-agent cannot write files");
  assert.equal(decision.action.type, "tool");
  assert.equal(decision.action.capability, "filesystem.write");
  assert.equal(decision.action.riskLevel, "high");
});

test("policy returns approval_required after allowlist and permission gates pass", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["filesystem.write"],
    permissions: {
      canWriteFiles: true,
      requiresApprovalFor: ["filesystem.write"]
    },
    resourceScopes: [{ type: "filesystem.path", path: "/business/docs", access: "write" }]
  });

  const decision = policy.canUseTool(agent, "filesystem.writeFile", {
    input: { path: "/business/docs/notes.txt" }
  });

  assert.equal(decision.decision, "approval_required");
  assert.equal(decision.allowed, false);
  assert.equal(decision.policyRuleId, "tool.approval_required");
  assert.equal(
    decision.reason,
    "policy-test-agent requires approval to use filesystem.writeFile (filesystem.write)"
  );
  assert.equal(decision.action.type, "tool");
  assert.equal(decision.action.capability, "filesystem.write");
  assert.equal(decision.action.riskLevel, "high");
});

test("policy denies filesystem tools when path input is missing", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["filesystem.read"],
    permissions: { canReadFiles: true },
    resourceScopes: [{ type: "filesystem.path", path: "/business/docs", access: "read" }]
  });

  const decision = policy.canUseTool(agent, "filesystem.readFile");

  assert.equal(decision.decision, "denied");
  assert.equal(decision.policyRuleId, "resource.path_required");
  assert.equal(decision.reason, "policy-test-agent must provide a path for filesystem.read");
});

test("policy denies filesystem paths outside approved scopes", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["filesystem.read"],
    permissions: { canReadFiles: true },
    resourceScopes: [{ type: "filesystem.path", path: "/business/docs", access: "read" }]
  });

  const decision = policy.canUseTool(agent, "filesystem.readFile", {
    input: { path: "/business/private/payroll.txt" }
  });

  assert.equal(decision.decision, "denied");
  assert.equal(decision.policyRuleId, "resource.scope");
  assert.equal(
    decision.reason,
    "policy-test-agent cannot access /business/private/payroll.txt with filesystem.read"
  );
});

test("policy normalizes paths before scope checks", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["filesystem.read"],
    permissions: { canReadFiles: true },
    resourceScopes: [{ type: "filesystem.path", path: "/business/docs", access: "read" }]
  });

  const allowedDecision = policy.canUseTool(agent, "filesystem.readFile", {
    input: { path: "/business/docs/2026/../invoice.txt" }
  });
  const deniedDecision = policy.canUseTool(agent, "filesystem.readFile", {
    input: { path: "/business/docs/../../private/payroll.txt" }
  });

  assert.equal(allowedDecision.decision, "allowed");
  assert.equal(allowedDecision.resource.type, "tool");
  assert.equal(allowedDecision.resource.path, "/business/docs/invoice.txt");
  assert.equal(deniedDecision.decision, "denied");
  assert.equal(deniedDecision.policyRuleId, "resource.scope");
});

test("business policy overrides can grant tools for one business", () => {
  const policy = new PolicyEngine({
    businessOverrides: [
      {
        businessId: "business-1",
        agentId: "policy-test-agent",
        allowedTools: ["workspace.note"]
      }
    ]
  });
  const agent = makeAgent({ allowedTools: [] });

  const allowedDecision = policy.canUseTool(agent, "workspace.note", { businessId: "business-1" });
  const deniedDecision = policy.canUseTool(agent, "workspace.note", { businessId: "business-2" });

  assert.equal(allowedDecision.decision, "allowed");
  assert.equal(allowedDecision.businessId, "business-1");
  assert.equal(deniedDecision.decision, "denied");
  assert.equal(deniedDecision.policyRuleId, "tool.allowlist");
});

test("business policy override denials take precedence over base grants", () => {
  const policy = new PolicyEngine({
    businessOverrides: [
      {
        businessId: "business-1",
        agentId: "policy-test-agent",
        deniedTools: ["workspace.note"]
      }
    ]
  });
  const agent = makeAgent({ allowedTools: ["workspace.note"] });

  const decision = policy.canUseTool(agent, "workspace.note", { businessId: "business-1" });

  assert.equal(decision.decision, "denied");
  assert.equal(decision.policyRuleId, "business.override.denied");
  assert.equal(
    decision.reason,
    "policy-test-agent is denied workspace.note (workspace.note) for business business-1"
  );
});

test("business policy overrides can require approval and add resource scopes", () => {
  const policy = new PolicyEngine({
    businessOverrides: [
      {
        businessId: "business-1",
        agentId: "policy-test-agent",
        requiresApprovalFor: ["filesystem.read"],
        resourceScopes: [
          {
            type: "filesystem.path",
            path: "/business/docs",
            access: "read",
            businessId: "business-1"
          }
        ]
      }
    ]
  });
  const agent = makeAgent({
    allowedTools: ["filesystem.read"],
    permissions: { canReadFiles: true }
  });

  const businessDecision = policy.canUseTool(agent, "filesystem.readFile", {
    businessId: "business-1",
    input: { path: "/business/docs/invoice.txt" }
  });
  const unscopedDecision = policy.canUseTool(agent, "filesystem.readFile", {
    input: { path: "/business/docs/invoice.txt" }
  });

  assert.equal(businessDecision.decision, "approval_required");
  assert.equal(businessDecision.businessId, "business-1");
  assert.equal(businessDecision.policyRuleId, "tool.approval_required");
  assert.equal(businessDecision.resource.type, "tool");
  assert.equal(businessDecision.resource.scope?.businessId, "business-1");
  assert.equal(unscopedDecision.decision, "denied");
  assert.equal(unscopedDecision.policyRuleId, "resource.scope");
});

test("policy denial takes precedence over approval requirements", () => {
  const policy = new PolicyEngine();
  const agent = makeAgent({
    allowedTools: ["workspace.note"],
    permissions: { requiresApprovalFor: ["shell.exec"] }
  });

  const decision = policy.canUseTool(agent, "shell.exec");

  assert.equal(decision.decision, "denied");
  assert.equal(decision.policyRuleId, "tool.allowlist");
});

test("tool broker records explainable policy denial metadata", async () => {
  const events = new EventLog();
  const policy = new PolicyEngine();
  const registry = new ToolRegistry();
  const broker = new ToolBroker(policy, registry, events);
  const agent = makeAgent({ allowedTools: ["workspace.note"] });

  const result = await broker.execute(agent, "shell.exec", { command: "echo denied" });
  const deniedEvent = events.list().find((event) => event.type === "tool.denied");

  assert.equal(result.ok, false);
  assert.equal(result.output, "policy-test-agent is not allowed to use shell.exec (shell.exec)");
  assert.ok(deniedEvent);
  assert.equal(deniedEvent.data.decision, "denied");
  assert.equal(deniedEvent.data.reason, "policy-test-agent is not allowed to use shell.exec (shell.exec)");
  assert.equal(deniedEvent.data.policyRuleId, "tool.allowlist");
  assert.deepEqual(deniedEvent.data.resource, {
    type: "tool",
    name: "shell.exec",
    capability: "shell.exec",
    riskLevel: "critical"
  });
});

test("tool broker records approval_required without executing the tool handler", async () => {
  let writeCalled = false;
  const events = new EventLog();
  const policy = new PolicyEngine();
  const registry = new ToolRegistry();
  const broker = new ToolBroker(policy, registry, events);
  const agent = makeAgent({
    allowedTools: ["filesystem.write"],
    permissions: {
      canWriteFiles: true,
      requiresApprovalFor: ["filesystem.write"]
    },
    resourceScopes: [{ type: "filesystem.path", path: "/business/docs", access: "write" }]
  });

  registry.register("filesystem.writeFile", () => {
    writeCalled = true;
    return {
      ok: true,
      output: "write should wait for approval"
    };
  });

  const result = await broker.execute(agent, "filesystem.writeFile", {
    path: "/business/docs/example.txt"
  });
  const savedEvents = events.list();
  const approvalEvent = savedEvents.find((event) => event.type === "tool.approval_required");

  assert.equal(writeCalled, false);
  assert.equal(result.ok, false);
  assert.equal(
    result.output,
    "policy-test-agent requires approval to use filesystem.writeFile (filesystem.write)"
  );
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.data.decision, "approval_required");
  assert.equal(approvalEvent.data.policyRuleId, "tool.approval_required");
  assert.deepEqual(approvalEvent.data.action, {
    type: "tool",
    name: "filesystem.writeFile",
    capability: "filesystem.write",
    riskLevel: "high"
  });
  assert.equal(savedEvents.some((event) => event.type === "tool.denied"), false);
  assert.equal(savedEvents.some((event) => event.type === "tool.completed"), false);
});

function makeAgent(input: {
  allowedTools: string[];
  permissions?: Partial<AgentDefinition["permissions"]>;
  resourceScopes?: AgentResourceScope[];
}): AgentDefinition {
  return {
    id: "policy-test-agent",
    name: "Policy Test Agent",
    role: "Exercises policy model contracts.",
    systemPrompt: "Request authority through Harmony.",
    model: {
      provider: "local-stub",
      model: "policy-test"
    },
    allowedTools: input.allowedTools,
    canTalkTo: [],
    permissions: {
      canReadFiles: false,
      canWriteFiles: false,
      canRunCommands: false,
      requiresApprovalFor: [],
      ...input.permissions
    },
    resourceScopes: input.resourceScopes
  };
}
