import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HarmonyEvent } from "./event-types.js";

type SerializedHarmonyEvent = Omit<HarmonyEvent, "at"> & {
  at: string;
};

export interface EventStore {
  load(): HarmonyEvent[];
  append(event: HarmonyEvent): void;
}

export class MemoryEventStore implements EventStore {
  load(): HarmonyEvent[] {
    return [];
  }

  append(): void {
    return undefined;
  }
}

export class JsonlEventStore implements EventStore {
  constructor(private readonly filePath: string) {}

  load(): HarmonyEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    return readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => deserializeEvent(JSON.parse(line) as SerializedHarmonyEvent));
  }

  append(event: HarmonyEvent): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(serializeEvent(event))}\n`, "utf8");
  }
}

function serializeEvent(event: HarmonyEvent): SerializedHarmonyEvent {
  return {
    ...event,
    at: event.at.toISOString()
  };
}

function deserializeEvent(event: SerializedHarmonyEvent): HarmonyEvent {
  return {
    ...event,
    at: new Date(event.at)
  } as HarmonyEvent;
}
