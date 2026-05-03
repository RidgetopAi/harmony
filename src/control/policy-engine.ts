import path from "node:path";
import type { AgentDefinition, AgentResourceScope } from "../agents/agent-definition.js";

export const CAPABILITY_NAMESPACES = [
  "filesystem.read",
  "filesystem.write",
  "shell.exec",
  "git.diff"
] as const;

export type KnownCapabilityNamespace = (typeof CAPABILITY_NAMESPACES)[number];
export type CapabilityNamespace = KnownCapabilityNamespace | (string & {});
export type PolicyDecisionState = "allowed" | "denied" | "approval_required";
export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export type PolicyAction =
  | {
      type: "tool";
      name: string;
      capability: CapabilityNamespace;
      riskLevel: ToolRiskLevel;
    }
  | {
      type: "message";
      targetAgentId: string;
    };

export type PolicyResource =
  | {
      type: "tool";
      name: string;
      capability: CapabilityNamespace;
      riskLevel: ToolRiskLevel;
      path?: string;
      scope?: AgentResourceScope;
    }
  | {
      type: "agent";
      agentId: string;
    };

export type PolicyToolContext = {
  input?: unknown;
  businessId?: string;
};

export type BusinessPolicyOverride = {
  businessId: string;
  agentId: string;
  allowedTools?: string[];
  deniedTools?: string[];
  requiresApprovalFor?: string[];
  resourceScopes?: AgentResourceScope[];
};

export type PolicyEngineOptions = {
  businessOverrides?: BusinessPolicyOverride[];
};

export type PolicyDecision =
  | {
      decision: "allowed";
      allowed: true;
      reason: string;
      agentId: string;
      action: PolicyAction;
      resource: PolicyResource;
      businessId?: string;
      policyRuleId?: string;
    }
  | {
      decision: "denied";
      allowed: false;
      reason: string;
      agentId: string;
      action: PolicyAction;
      resource: PolicyResource;
      businessId?: string;
      policyRuleId?: string;
    }
  | {
      decision: "approval_required";
      allowed: false;
      reason: string;
      agentId: string;
      action: PolicyAction;
      resource: PolicyResource;
      businessId?: string;
      policyRuleId?: string;
    };

export class PolicyEngine {
  private readonly businessOverrides: BusinessPolicyOverride[];

  constructor(options: PolicyEngineOptions = {}) {
    this.businessOverrides = options.businessOverrides ?? [];
  }

  canUseTool(agent: AgentDefinition, toolName: string, context: PolicyToolContext = {}): PolicyDecision {
    const businessOverride = this.getBusinessOverride(agent, context.businessId);
    const capability = getCapabilityNamespace(toolName);
    const riskLevel = getToolRiskLevel(toolName, capability);
    const action: PolicyAction = { type: "tool", name: toolName, capability, riskLevel };
    const requestedPath = getFilesystemPath(capability, context.input);
    const resource: PolicyResource = {
      type: "tool",
      name: toolName,
      capability,
      riskLevel
    };

    if (requestedPath) {
      resource.path = requestedPath;
    }

    if (businessOverride && matchesToolGrant(businessOverride.deniedTools, toolName, capability)) {
      return deniedDecision({
        agent,
        action,
        resource,
        businessId: context.businessId,
        policyRuleId: "business.override.denied",
        reason: `${agent.id} is denied ${toolName} (${capability}) for business ${context.businessId}`
      });
    }

    if (!canUseCapability(agent, businessOverride, toolName, capability)) {
      return deniedDecision({
        agent,
        action,
        resource,
        businessId: context.businessId,
        policyRuleId: "tool.allowlist",
        reason: `${agent.id} is not allowed to use ${toolName} (${capability})`
      });
    }

    if (capability === "shell.exec" && !agent.permissions.canRunCommands) {
      return deniedDecision({
        agent,
        action,
        resource,
        businessId: context.businessId,
        policyRuleId: "permission.shell.exec",
        reason: `${agent.id} cannot run shell commands`
      });
    }

    if (capability === "filesystem.write" && !agent.permissions.canWriteFiles) {
      return deniedDecision({
        agent,
        action,
        resource,
        businessId: context.businessId,
        policyRuleId: "permission.filesystem.write",
        reason: `${agent.id} cannot write files`
      });
    }

    if (capability === "filesystem.read" && !agent.permissions.canReadFiles) {
      return deniedDecision({
        agent,
        action,
        resource,
        businessId: context.businessId,
        policyRuleId: "permission.filesystem.read",
        reason: `${agent.id} cannot read files`
      });
    }

    const scopeDecision = checkFilesystemScope({
      agent,
      action,
      resource,
      capability,
      requestedPath,
      scopes: getResourceScopes(agent, businessOverride),
      businessId: context.businessId
    });

    if (scopeDecision) {
      return scopeDecision;
    }

    if (requiresApproval(agent, businessOverride, toolName, capability)) {
      return approvalRequiredDecision({
        agent,
        action,
        resource,
        businessId: context.businessId,
        policyRuleId: "tool.approval_required",
        reason: `${agent.id} requires approval to use ${toolName} (${capability})`
      });
    }

    return {
      decision: "allowed",
      allowed: true,
      reason: `${agent.id} can use ${toolName}`,
      agentId: agent.id,
      action,
      resource,
      businessId: context.businessId,
      policyRuleId: "tool.allowed"
    };
  }

  canMessage(agent: AgentDefinition, targetAgentId: string): PolicyDecision {
    const action: PolicyAction = { type: "message", targetAgentId };
    const resource: PolicyResource = { type: "agent", agentId: targetAgentId };

    if (!agent.canTalkTo.includes(targetAgentId)) {
      return deniedDecision({
        agent,
        action,
        resource,
        policyRuleId: "message.allowlist",
        reason: `${agent.id} cannot message ${targetAgentId}`
      });
    }

    return {
      decision: "allowed",
      allowed: true,
      reason: `${agent.id} can message ${targetAgentId}`,
      agentId: agent.id,
      action,
      resource,
      policyRuleId: "message.allowed"
    };
  }

  private getBusinessOverride(
    agent: AgentDefinition,
    businessId: string | undefined
  ): BusinessPolicyOverride | undefined {
    if (!businessId) {
      return undefined;
    }

    return this.businessOverrides.find(
      (override) => override.businessId === businessId && override.agentId === agent.id
    );
  }
}

export function getCapabilityNamespace(toolName: string): CapabilityNamespace {
  const knownNamespace = CAPABILITY_NAMESPACES.find((namespace) =>
    matchesKnownNamespace(toolName, namespace)
  );

  if (knownNamespace) {
    return knownNamespace;
  }

  const [domain, action] = toolName.split(".");

  if (domain && action) {
    return `${domain}.${action}`;
  }

  return toolName;
}

export function getToolRiskLevel(
  toolName: string,
  capability: CapabilityNamespace = getCapabilityNamespace(toolName)
): ToolRiskLevel {
  if (capability === "shell.exec") {
    return "critical";
  }

  if (capability === "filesystem.write") {
    return "high";
  }

  if (capability === "filesystem.read") {
    return "medium";
  }

  if (capability === "git.diff") {
    return "low";
  }

  return "low";
}

function matchesKnownNamespace(toolName: string, namespace: KnownCapabilityNamespace): boolean {
  if (toolName === namespace || toolName.startsWith(`${namespace}.`)) {
    return true;
  }

  if (
    (namespace === "filesystem.read" || namespace === "filesystem.write") &&
    toolName.startsWith(namespace)
  ) {
    const suffix = toolName.slice(namespace.length);
    return suffix.length > 0 && /^[A-Z]/.test(suffix);
  }

  return false;
}

function canUseCapability(
  agent: AgentDefinition,
  businessOverride: BusinessPolicyOverride | undefined,
  toolName: string,
  capability: CapabilityNamespace
): boolean {
  return (
    agent.allowedTools.includes("*") ||
    agent.allowedTools.includes(toolName) ||
    agent.allowedTools.includes(capability) ||
    matchesToolGrant(businessOverride?.allowedTools, toolName, capability)
  );
}

function getFilesystemPath(capability: CapabilityNamespace, input: unknown): string | undefined {
  if (capability !== "filesystem.read" && capability !== "filesystem.write") {
    return undefined;
  }

  if (typeof input === "object" && input !== null && !Array.isArray(input) && "path" in input) {
    const candidate = (input as { path?: unknown }).path;

    if (typeof candidate === "string" && candidate.length > 0) {
      return normalizePolicyPath(candidate);
    }
  }

  return undefined;
}

function checkFilesystemScope(input: {
  agent: AgentDefinition;
  action: PolicyAction;
  resource: PolicyResource;
  capability: CapabilityNamespace;
  requestedPath?: string;
  scopes: AgentResourceScope[];
  businessId?: string;
}): PolicyDecision | undefined {
  const requiredAccess = getRequiredFilesystemAccess(input.capability);

  if (!requiredAccess) {
    return undefined;
  }

  if (!input.requestedPath) {
    return deniedDecision({
      agent: input.agent,
      action: input.action,
      resource: input.resource,
      businessId: input.businessId,
      policyRuleId: "resource.path_required",
      reason: `${input.agent.id} must provide a path for ${input.capability}`
    });
  }

  const requestedPath = input.requestedPath;
  const matchingScope = input.scopes.find(
    (scope) =>
      scope.type === "filesystem.path" &&
      scopeAllowsBusiness(scope, input.businessId) &&
      scopeAllowsAccess(scope, requiredAccess) &&
      pathIsWithinScope(requestedPath, scope.path)
  );

  if (!matchingScope) {
    return deniedDecision({
      agent: input.agent,
      action: input.action,
      resource: input.resource,
      businessId: input.businessId,
      policyRuleId: "resource.scope",
      reason: `${input.agent.id} cannot access ${requestedPath} with ${input.capability}`
    });
  }

  if (input.resource.type === "tool") {
    input.resource.scope = matchingScope;
  }

  return undefined;
}

function getRequiredFilesystemAccess(capability: CapabilityNamespace): "read" | "write" | undefined {
  if (capability === "filesystem.read") {
    return "read";
  }

  if (capability === "filesystem.write") {
    return "write";
  }

  return undefined;
}

function scopeAllowsBusiness(scope: AgentResourceScope, businessId?: string): boolean {
  return !scope.businessId || scope.businessId === businessId;
}

function scopeAllowsAccess(scope: AgentResourceScope, requiredAccess: "read" | "write"): boolean {
  return scope.access === requiredAccess || scope.access === "read_write";
}

function pathIsWithinScope(requestedPath: string, scopePath: string): boolean {
  const normalizedScope = normalizePolicyPath(scopePath);
  const relativePath = path.relative(normalizedScope, requestedPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizePolicyPath(policyPath: string): string {
  return path.resolve("/", policyPath);
}

function requiresApproval(
  agent: AgentDefinition,
  businessOverride: BusinessPolicyOverride | undefined,
  toolName: string,
  capability: CapabilityNamespace
): boolean {
  return (
    agent.permissions.requiresApprovalFor.includes("*") ||
    agent.permissions.requiresApprovalFor.includes(toolName) ||
    agent.permissions.requiresApprovalFor.includes(capability) ||
    matchesToolGrant(businessOverride?.requiresApprovalFor, toolName, capability)
  );
}

function getResourceScopes(
  agent: AgentDefinition,
  businessOverride: BusinessPolicyOverride | undefined
): AgentResourceScope[] {
  return [...(agent.resourceScopes ?? []), ...(businessOverride?.resourceScopes ?? [])];
}

function matchesToolGrant(
  grants: string[] | undefined,
  toolName: string,
  capability: CapabilityNamespace
): boolean {
  return Boolean(
    grants?.includes("*") || grants?.includes(toolName) || grants?.includes(capability)
  );
}

function deniedDecision(input: {
  agent: AgentDefinition;
  action: PolicyAction;
  resource: PolicyResource;
  businessId?: string;
  reason: string;
  policyRuleId: string;
}): PolicyDecision {
  return {
    decision: "denied",
    allowed: false,
    reason: input.reason,
    agentId: input.agent.id,
    action: input.action,
    resource: input.resource,
    businessId: input.businessId,
    policyRuleId: input.policyRuleId
  };
}

function approvalRequiredDecision(input: {
  agent: AgentDefinition;
  action: PolicyAction;
  resource: PolicyResource;
  businessId?: string;
  reason: string;
  policyRuleId: string;
}): PolicyDecision {
  return {
    decision: "approval_required",
    allowed: false,
    reason: input.reason,
    agentId: input.agent.id,
    action: input.action,
    resource: input.resource,
    businessId: input.businessId,
    policyRuleId: input.policyRuleId
  };
}
