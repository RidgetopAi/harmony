# Harmony

Harmony is an experimental TypeScript control plane for agent runtimes.

The goal is to learn the layer that sits above a harness and systematically controls:

- agent definitions
- task routing
- tool permissions
- agent-to-agent communication
- runtime/harness adapters
- event logging

Core model:

```text
Agents produce intent.
Control plane grants or denies authority.
Harness performs execution.
Event log records truth.
```

## First Version

This first version uses a local stub harness instead of real model calls. That keeps the authority boundary clear before adding `pi-mono`, local models, or API model providers.

Run it:

```bash
npm install
npm run demo
```

Useful scripts:

```bash
npm run type-check
npm run build
npm run spike:pi-core
npm start
```

## Current Scope

Version 0.1 demonstrates:

- config-defined agents
- one routed task
- policy-checked tool calls
- policy-checked agent messages
- event logging for allowed and denied actions

It intentionally does not include memory, vector search, autonomous loops, scheduling, UI, or production harness integration yet.

## Planning Docs

- [Architecture](./ARCHITECTURE.md)
- [Roadmap](./docs/ROADMAP.md)
- [Project Contracts](./docs/PROJECT_CONTRACTS.md)
- [Decision 001: Use pi-agent-core](./docs/decisions/001-use-pi-agent-core.md)
