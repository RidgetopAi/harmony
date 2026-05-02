export type ModelProvider = "local-stub" | "api";

export type ModelConfig = {
  provider: ModelProvider;
  model: string;
  temperature?: number;
};

export type AgentPermissions = {
  canReadFiles: boolean;
  canWriteFiles: boolean;
  canRunCommands: boolean;
  requiresApprovalFor: string[];
};

export type AgentDefinition = {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: ModelConfig;
  allowedTools: string[];
  canTalkTo: string[];
  permissions: AgentPermissions;
};
