export type HarmonyEventType =
  | "task.created"
  | "task.routed"
  | "agent.session_started"
  | "agent.output"
  | "agent.action_invalid"
  | "agent.run_failed"
  | "tool.allowed"
  | "tool.denied"
  | "tool.completed"
  | "message.allowed"
  | "message.denied"
  | "message.delivered";

export type HarmonyEvent = {
  id: string;
  type: HarmonyEventType;
  at: Date;
  actorId?: string;
  targetId?: string;
  data: Record<string, unknown>;
};
