export type AgentSessionState =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "stopped";

export type AgentSession = {
  id: string;
  agentId: string;
  harnessName: string;
  state: AgentSessionState;
  startedAt: Date;
  lastActiveAt: Date;
  endedAt?: Date;
};
