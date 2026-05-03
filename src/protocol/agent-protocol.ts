export const AGENT_PROTOCOL_FORMAT = "structured-intent";

export const AGENT_PROTOCOL_INSTRUCTIONS = [
  "Respond with JSON matching the structured-intent protocol.",
  "Put human-readable reasoning or results in content.",
  "Put tool and message requests in actions.",
  "Do not claim that you executed a tool, command, file operation, or agent message directly.",
  "Request authority through actions and wait for Harmony to allow, deny, or execute them."
].join(" ");

export type AgentProtocolFormat = typeof AGENT_PROTOCOL_FORMAT;

export type ToolAction = {
  type: "tool";
  toolName: string;
  input: unknown;
};

export type MessageAction = {
  type: "message";
  toAgentId: string;
  content: string;
};

export type AgentAction = ToolAction | MessageAction;

export type AgentOutput = {
  agentId: string;
  content: string;
  actions: AgentAction[];
  format: AgentProtocolFormat;
  rawOutput?: unknown;
};

export type AgentProtocolParseResult =
  | { ok: true; output: AgentOutput }
  | ({
      ok: false;
      reason: string;
    } & AgentProtocolOutputIssue);

export type AgentActionParseResult =
  | { ok: true; action: AgentAction }
  | ({
      ok: false;
      reason: string;
    } & AgentActionIssue);

export type AgentProtocolOutputIssue =
  | { code: "output_not_object" }
  | { code: "invalid_format" }
  | { code: "missing_agent_id" }
  | { code: "invalid_content" }
  | { code: "invalid_actions" }
  | {
      code: "invalid_action";
      actionIndex: number;
      actionIssue: AgentActionIssue;
    }
  | { code: "invalid_json" };

export type AgentActionIssue =
  | { code: "action_not_object" }
  | { code: "missing_tool_name" }
  | { code: "missing_tool_input" }
  | { code: "missing_target_agent" }
  | { code: "invalid_message_content" }
  | { code: "invalid_action_type" };

export const agentProtocolSchemas = {
  output: {
    type: "object",
    required: ["agentId", "content", "actions", "format"],
    properties: {
      agentId: { type: "string", minLength: 1 },
      content: { type: "string" },
      actions: {
        type: "array",
        items: {
          anyOf: [{ ref: "toolAction" }, { ref: "messageAction" }]
        }
      },
      format: { const: AGENT_PROTOCOL_FORMAT },
      rawOutput: {}
    }
  },
  toolAction: {
    type: "object",
    required: ["type", "toolName", "input"],
    properties: {
      type: { const: "tool" },
      toolName: { type: "string", minLength: 1 },
      input: {}
    }
  },
  messageAction: {
    type: "object",
    required: ["type", "toAgentId", "content"],
    properties: {
      type: { const: "message" },
      toAgentId: { type: "string", minLength: 1 },
      content: { type: "string" }
    }
  }
} as const;

export function parseAgentOutput(value: unknown): AgentProtocolParseResult {
  if (!isRecord(value)) {
    return { ok: false, code: "output_not_object", reason: "Agent output must be an object." };
  }

  if (value.format !== AGENT_PROTOCOL_FORMAT) {
    return {
      ok: false,
      code: "invalid_format",
      reason: "Agent output format must be structured-intent."
    };
  }

  if (typeof value.agentId !== "string" || value.agentId.length === 0) {
    return { ok: false, code: "missing_agent_id", reason: "Agent output must include agentId." };
  }

  if (typeof value.content !== "string") {
    return { ok: false, code: "invalid_content", reason: "Agent output content must be a string." };
  }

  if (!Array.isArray(value.actions)) {
    return { ok: false, code: "invalid_actions", reason: "Agent output actions must be an array." };
  }

  const actions: AgentAction[] = [];

  for (const [index, action] of value.actions.entries()) {
    const result = parseAgentAction(action);

    if (!result.ok) {
      return {
        ok: false,
        code: "invalid_action",
        actionIndex: index,
        actionIssue: {
          code: result.code
        },
        reason: `Invalid action at index ${index}: ${result.reason}`
      };
    }

    actions.push(result.action);
  }

  return {
    ok: true,
    output: {
      agentId: value.agentId,
      content: value.content,
      actions,
      format: AGENT_PROTOCOL_FORMAT,
      rawOutput: value.rawOutput
    }
  };
}

export function parseAgentOutputText(text: string): AgentProtocolParseResult {
  try {
    return parseAgentOutput(JSON.parse(text));
  } catch {
    return { ok: false, code: "invalid_json", reason: "Agent output text must be valid JSON." };
  }
}

export function parseAgentAction(value: unknown): AgentActionParseResult {
  if (!isRecord(value)) {
    return { ok: false, code: "action_not_object", reason: "action must be an object." };
  }

  if (value.type === "tool") {
    return parseToolAction(value);
  }

  if (value.type === "message") {
    return parseMessageAction(value);
  }

  return { ok: false, code: "invalid_action_type", reason: "action type must be tool or message." };
}

function parseToolAction(
  value: Record<string, unknown>
): AgentActionParseResult {
  if (typeof value.toolName !== "string" || value.toolName.length === 0) {
    return { ok: false, code: "missing_tool_name", reason: "tool action must include toolName." };
  }

  if (!Object.hasOwn(value, "input")) {
    return { ok: false, code: "missing_tool_input", reason: "tool action must include input." };
  }

  return {
    ok: true,
    action: {
      type: "tool",
      toolName: value.toolName,
      input: value.input
    }
  };
}

function parseMessageAction(
  value: Record<string, unknown>
): AgentActionParseResult {
  if (typeof value.toAgentId !== "string" || value.toAgentId.length === 0) {
    return {
      ok: false,
      code: "missing_target_agent",
      reason: "message action must include toAgentId."
    };
  }

  if (typeof value.content !== "string") {
    return {
      ok: false,
      code: "invalid_message_content",
      reason: "message action content must be a string."
    };
  }

  return {
    ok: true,
    action: {
      type: "message",
      toAgentId: value.toAgentId,
      content: value.content
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
