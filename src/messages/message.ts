export type AgentMessage = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  createdAt: Date;
};
