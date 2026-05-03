import type { AgentSessionState } from "../agents/agent-session.js";
import type { PolicyAction, PolicyDecisionState, PolicyResource } from "../control/policy-engine.js";
import type { AgentAction, AgentProtocolFormat } from "../protocol/agent-protocol.js";
import type { RuntimeError, RuntimeOutputMode } from "../runtime/runtime-harness.js";

export type HarmonyEventType =
  | "task.created"
  | "task.routed"
  | "agent.session_started"
  | "agent.output"
  | "agent.action_invalid"
  | "agent.run_failed"
  | "tool.allowed"
  | "tool.denied"
  | "tool.approval_required"
  | "tool.completed"
  | "policy.decision_recorded"
  | "message.allowed"
  | "message.denied"
  | "message.delivered"
  | "approval.requested"
  | "approval.resolved"
  | "connector.configured"
  | "connector.discovery_started"
  | "connector.discovery_completed"
  | "connector.ingestion_started"
  | "connector.ingestion_completed"
  | "connector.failed";

export type HarmonyEventIdentity = {
  id: string;
  at: Date;
  actorId?: string;
  targetId?: string;
  businessId?: string;
  sourceId?: string;
  sourceRootId?: string;
  sourceScopeId?: string;
  taskId?: string;
  sessionId?: string;
  correlationId?: string;
};

export type PolicyDecisionEventPayload = {
  decision: PolicyDecisionState;
  reason?: string;
  action: PolicyAction;
  resource: PolicyResource;
  policyRuleId?: string;
  businessId?: string;
  sourceId?: string;
  sourceRootId?: string;
  sourceScopeId?: string;
};

export type ToolEventPayload = PolicyDecisionEventPayload & {
  toolName: string;
  ok?: boolean;
  output?: unknown;
};

export type MessagePolicyEventPayload = PolicyDecisionEventPayload & {
  messageId?: string;
};

export type ApprovalTargetType =
  | "source"
  | "sourceRoot"
  | "sourceScope"
  | "document"
  | "folder"
  | "toolAction"
  | "agentAction"
  | "discoveryJob"
  | "deepIndexingJob";

export type ApprovalEventPayload = {
  approvalId: string;
  status: "pending" | "approved" | "denied" | "deferred" | "expired";
  targetType: ApprovalTargetType;
  targetId: string;
  requestedByAgentId?: string;
  resolvedByActorId?: string;
  reason?: string;
  businessId?: string;
  sourceId?: string;
  sourceRootId?: string;
  sourceScopeId?: string;
};

export type ConnectorEventPayload = {
  connectorId: string;
  lifecycle:
    | "configured"
    | "connected"
    | "discovered"
    | "reviewed"
    | "approved"
    | "ingested"
    | "paused"
    | "revoked"
    | "deleted"
    | "failed";
  businessId: string;
  sourceId: string;
  sourceRootId?: string;
  sourceScopeId?: string;
  error?: string;
  counts?: Record<string, number>;
};

export type HarmonyEventPayloads = {
  "task.created": {
    taskId: string;
    content: string;
  };
  "task.routed": {
    taskId: string;
  };
  "agent.session_started": {
    sessionId: string;
    harnessName: string;
    state: AgentSessionState;
    taskId?: string;
  };
  "agent.output": {
    content: string;
    actions: AgentAction[];
    format: AgentProtocolFormat;
    rawOutput?: unknown;
    sessionId?: string;
    taskId?: string;
  };
  "agent.action_invalid": {
    sessionId: string;
    status: "invalid";
    actionIndex: number;
    actionIssue: unknown;
    reason: string;
    outputMode: RuntimeOutputMode;
    durationMs: number;
    rawOutput?: unknown;
    taskId?: string;
  };
  "agent.run_failed": {
    sessionId: string;
    status: "failed" | "timed_out";
    outputMode: RuntimeOutputMode;
    durationMs: number;
    error: RuntimeError & {
      validationCode?: string;
    };
    rawOutput?: unknown;
    taskId?: string;
  };
  "tool.allowed": ToolEventPayload;
  "tool.denied": ToolEventPayload;
  "tool.approval_required": ToolEventPayload;
  "tool.completed": {
    toolName: string;
    ok: boolean;
    output: unknown;
    businessId?: string;
    sourceId?: string;
    sourceRootId?: string;
    sourceScopeId?: string;
  };
  "policy.decision_recorded": PolicyDecisionEventPayload;
  "message.allowed": MessagePolicyEventPayload;
  "message.denied":
    | MessagePolicyEventPayload
    | {
        reason: string;
      };
  "message.delivered": {
    messageId: string;
    sessionId: string;
    status: "completed" | "failed" | "timed_out";
    response: unknown;
    taskId?: string;
  };
  "approval.requested": ApprovalEventPayload;
  "approval.resolved": ApprovalEventPayload;
  "connector.configured": ConnectorEventPayload;
  "connector.discovery_started": ConnectorEventPayload;
  "connector.discovery_completed": ConnectorEventPayload;
  "connector.ingestion_started": ConnectorEventPayload;
  "connector.ingestion_completed": ConnectorEventPayload;
  "connector.failed": ConnectorEventPayload;
};

export type HarmonyEvent<EventType extends HarmonyEventType = HarmonyEventType> = {
  [Type in EventType]: HarmonyEventIdentity & {
    type: Type;
    data: HarmonyEventPayloads[Type];
  };
}[EventType];

export type RecordableHarmonyEvent<EventType extends HarmonyEventType = HarmonyEventType> = {
  [Type in EventType]: Partial<HarmonyEventIdentity> & {
    type: Type;
    data: HarmonyEventPayloads[Type];
  };
}[EventType];
