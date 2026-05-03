import { parseAgentOutput } from "../protocol/agent-protocol.js";
import type { AgentProtocolParseResult } from "../protocol/agent-protocol.js";

export type AgentOutputValidation = AgentProtocolParseResult;

export function validateAgentOutput(value: unknown): AgentOutputValidation {
  return parseAgentOutput(value);
}
