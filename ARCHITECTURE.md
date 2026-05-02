# Harmony Architecture

Harmony separates authority from execution.

```text
User task
  -> Orchestrator
  -> Task Router
  -> Agent Session
  -> Agent intent
  -> Policy Engine
  -> Tool Broker / Message Broker
  -> Runtime Harness
  -> Event Log
```

## Components

### Orchestrator

Owns the task lifecycle. It creates sessions, routes tasks, receives agent intent, sends tool calls through the tool broker, sends messages through the message broker, and records events.

### Policy Engine

Answers yes/no questions:

- Can this agent use this tool?
- Can this agent message that agent?
- Does this action require approval?

### Tool Broker

The only path from an agent to a tool. It checks policy before dispatching to the registered tool implementation.

### Message Broker

The only path from one agent to another. It checks policy before delivering a message.

### Runtime Harness

The execution substrate. Today this is a local stub. Later it can be backed by `pi-mono`, Docker, local model processes, API model calls, or remote workers.

### Event Log

Records what actually happened, including denials. This is the audit surface for the system.

## Near-Term Direction

The first real harness adapter should wrap `git@github.com:badlogic/pi-mono.git` behind `RuntimeHarness`, rather than letting the rest of Harmony depend directly on pi-mono internals.
