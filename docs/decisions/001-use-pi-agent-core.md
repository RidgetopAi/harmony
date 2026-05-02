# Decision 001: Use pi-agent-core As The Preferred Runtime Loop

Date: 2026-05-02

Status: accepted

## Context

Harmony is the control plane for a small-business Company Brain. The core product requirement is not simply "run agents." The requirement is to run agents under clear authority:

- business-level boundaries
- source scopes
- tool permissions
- approval gates
- durable audit events
- provenance for business knowledge

Pi-mono is useful because it provides a compact, understandable agent loop and a concrete mental model for tool-calling agents. The choice is whether Harmony should integrate at the higher `pi-coding-agent` layer or the lower `pi-agent-core` layer.

## Decision

Harmony will use `@mariozechner/pi-agent-core` as the preferred long-term runtime loop.

Harmony will own:

- tool definitions
- policy checks
- source scopes
- approval flow
- event logging
- business data boundaries
- provenance rules
- connector/data-plane contracts

`pi-agent-core` will provide:

- model interaction loop
- assistant/tool-result continuation
- streaming event lifecycle
- steering/follow-up queue behavior
- abort/session runtime mechanics

`@mariozechner/pi-coding-agent` may still be used for:

- research
- smoke tests
- reference behavior
- comparing CLI/RPC modes
- understanding how pi structures tools and sessions

But it is not the preferred authority boundary for Harmony.

## Rationale

The higher `pi-coding-agent` layer is convenient, but it owns too much runtime surface for Harmony's core goal. It includes built-in tools, sessions, resource loading, extensions, interactive/print/json/RPC modes, and its own tool interception system.

For a Company Brain, Harmony must be able to answer:

```text
Why could this agent read that file?
Why could it not read that folder?
Who approved indexing?
Where did this fact come from?
What did the agent actually do?
Can we prove it?
```

Those answers are cleaner if Harmony owns the tools and policy boundary directly.

## Consequences

Positive:

- cleaner authority boundary
- lower risk of exposing raw shell/write/filesystem tools
- better alignment with business/source/approval/provenance model
- simpler explanation of what Harmony controls
- better learning path for TypeScript contracts and agent runtime design

Negative:

- more work for Harmony
- Harmony must define its own tools
- Harmony must define its own persistence/session story
- Harmony must own model provider wiring or wrap it carefully
- less reuse of pi-coding-agent's built-in conveniences

## Initial Spike

The first spike should prove this shape without real model keys:

```text
pi-agent-core Agent
  -> fake stream function emits a tool call
  -> Harmony-owned tool executes through policy
  -> allowed action succeeds
  -> denied action is blocked/logged
```

Success criteria:

- spike runs from `npm run spike:pi-core`
- no API key is required
- no raw shell/write/filesystem tool is exposed
- Harmony policy decides tool execution
- output shows pi agent events and Harmony policy events

## Spike Result

Status: complete.

Implemented:

`src/spikes/pi-agent-core-spike.ts`

Run with:

```bash
npm run spike:pi-core
```

The spike uses published packages:

```text
@mariozechner/pi-agent-core@0.72.1
@mariozechner/pi-ai@0.72.1
```

Result:

- fake stream model requested `workspace.note` and `shell.exec`
- Harmony policy allowed `workspace.note`
- Harmony policy denied `shell.exec`
- the dummy `shell.exec` implementation did not execute
- pi-agent-core continued after tool results and completed normally

Decision remains accepted.
