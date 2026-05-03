import { randomUUID } from "node:crypto";
import type {
  HarmonyEvent,
  HarmonyEventIdentity,
  HarmonyEventType,
  HarmonyEventPayloads,
  RecordableHarmonyEvent
} from "./event-types.js";
import { MemoryEventStore, type EventStore } from "./event-store.js";

export type EventQuery = {
  type?: HarmonyEventType | HarmonyEventType[];
  actorId?: string;
  targetId?: string;
  businessId?: string;
  sourceId?: string;
  sourceRootId?: string;
  sourceScopeId?: string;
  taskId?: string;
  sessionId?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  sort?: "asc" | "desc";
  limit?: number;
};

export class EventLog {
  private readonly events: HarmonyEvent[];

  constructor(private readonly store: EventStore = new MemoryEventStore()) {
    this.events = store.load().map((event) => cloneEvent(event));
  }

  record<EventType extends HarmonyEventType>(
    event: RecordableHarmonyEvent<EventType>
  ): HarmonyEvent<EventType> {
    const data = cloneEventData(event.data);
    const saved = {
      id: randomUUID(),
      ...deriveIdentityFromData(data),
      ...copyIdentity(event),
      type: event.type,
      at: copyDate(event.at) ?? new Date(),
      data
    } as HarmonyEvent<EventType>;

    this.store.append(saved as HarmonyEvent);
    this.events.push(saved as HarmonyEvent);
    return cloneEvent(saved);
  }

  list(query: EventQuery = {}): HarmonyEvent[] {
    let matches = this.events.filter((event) => matchesQuery(event, query));

    if (query.sort === "desc") {
      matches = [...matches].reverse();
    }

    if (typeof query.limit === "number") {
      matches = matches.slice(0, query.limit);
    }

    return matches.map((event) => cloneEvent(event));
  }

  findById(eventId: string): HarmonyEvent | undefined {
    const event = this.events.find((candidate) => candidate.id === eventId);
    return event ? cloneEvent(event) : undefined;
  }
}

function matchesQuery(event: HarmonyEvent, query: EventQuery): boolean {
  return (
    matchesType(event, query.type) &&
    matchesValue(event.actorId, query.actorId) &&
    matchesValue(event.targetId, query.targetId) &&
    matchesValue(event.businessId, query.businessId) &&
    matchesValue(event.sourceId, query.sourceId) &&
    matchesValue(event.sourceRootId, query.sourceRootId) &&
    matchesValue(event.sourceScopeId, query.sourceScopeId) &&
    matchesValue(event.taskId, query.taskId) &&
    matchesValue(event.sessionId, query.sessionId) &&
    matchesValue(event.correlationId, query.correlationId) &&
    matchesTimeRange(event, query)
  );
}

function matchesType(event: HarmonyEvent, type: EventQuery["type"]): boolean {
  if (!type) {
    return true;
  }

  if (Array.isArray(type)) {
    return type.includes(event.type);
  }

  return event.type === type;
}

function matchesValue(actual: string | undefined, expected: string | undefined): boolean {
  return !expected || actual === expected;
}

function matchesTimeRange(event: HarmonyEvent, query: EventQuery): boolean {
  if (query.from && event.at < query.from) {
    return false;
  }

  if (query.to && event.at > query.to) {
    return false;
  }

  return true;
}

function copyIdentity(event: Partial<HarmonyEventIdentity>): Partial<HarmonyEventIdentity> {
  return omitUndefined({
    id: event.id,
    at: copyDate(event.at),
    actorId: event.actorId,
    targetId: event.targetId,
    businessId: event.businessId,
    sourceId: event.sourceId,
    sourceRootId: event.sourceRootId,
    sourceScopeId: event.sourceScopeId,
    taskId: event.taskId,
    sessionId: event.sessionId,
    correlationId: event.correlationId
  });
}

function deriveIdentityFromData(data: unknown): Partial<HarmonyEventIdentity> {
  if (!isRecord(data)) {
    return {};
  }

  return omitUndefined({
    businessId: getString(data.businessId),
    sourceId: getString(data.sourceId),
    sourceRootId: getString(data.sourceRootId),
    sourceScopeId: getString(data.sourceScopeId),
    taskId: getString(data.taskId),
    sessionId: getString(data.sessionId)
  });
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function copyDate(date: Date | undefined): Date | undefined {
  return date ? new Date(date.getTime()) : undefined;
}

function cloneEvent<EventType extends HarmonyEventType>(
  event: HarmonyEvent<EventType>
): HarmonyEvent<EventType> {
  return {
    ...event,
    at: new Date(event.at.getTime()),
    data: cloneEventData(event.data)
  };
}

function cloneEventData<EventType extends HarmonyEventType>(
  data: HarmonyEventPayloads[EventType]
): HarmonyEventPayloads[EventType] {
  return structuredClone(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
