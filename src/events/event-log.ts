import { randomUUID } from "node:crypto";
import type { HarmonyEvent, HarmonyEventType } from "./event-types.js";

export class EventLog {
  private readonly events: HarmonyEvent[] = [];

  record(event: {
    type: HarmonyEventType;
    actorId?: string;
    targetId?: string;
    data?: Record<string, unknown>;
  }): HarmonyEvent {
    const saved: HarmonyEvent = {
      id: randomUUID(),
      type: event.type,
      at: new Date(),
      actorId: event.actorId,
      targetId: event.targetId,
      data: event.data ?? {}
    };

    this.events.push(saved);
    return saved;
  }

  list(): HarmonyEvent[] {
    return [...this.events];
  }
}
