# Pi-Mono Integration Notes

Date: 2026-05-02

## Current Local Checkout

Local path:

`/home/ridgetop/projects/pi-mono`

Remote:

`https://github.com/badlogic/pi-mono.git`

Local state:

```text
branch: main
working tree: clean
local HEAD: ce607fc343cbb1e3f6cc5923648de2a4df392201
local commit date: 2026-02-01
local commit subject: feat(coding-agent): type ToolCallEvent.input per tool (#1147)
remote main during inspection: 7268e9a9fda8b3f1b33ee26205e9610ccc9bd451
node_modules: missing
```

The local checkout is clean but stale relative to remote `main`, and dependencies are not installed.

Attempting to run:

```bash
./pi-test.sh --help
```

failed because dependencies are missing:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'chalk'
```

## Recommendation On Checkout

Do not wipe the existing checkout yet.

Recommended next move:

1. Keep `/home/ridgetop/projects/pi-mono` untouched as the current historical checkout.
2. Clone or update a clean integration copy side-by-side.

Suggested layout:

```text
/home/ridgetop/projects/pi-mono          existing checkout, leave intact for now
/home/ridgetop/projects/pi-mono-fresh    fresh remote main for inspection/integration
```

After Harmony has a working adapter and the fresh copy is confirmed, we can decide whether to replace the old checkout.

## Monorepo Shape

Important packages:

```text
packages/ai             @mariozechner/pi-ai
packages/agent          @mariozechner/pi-agent-core
packages/coding-agent   @mariozechner/pi-coding-agent
packages/tui            @mariozechner/pi-tui
packages/web-ui         @mariozechner/pi-web-ui
packages/mom            Slack bot around pi coding agent
packages/pods           vLLM pod deployment tooling
```

For Harmony, the important split is:

```text
@mariozechner/pi-agent-core
  core stateful LLM agent loop

@mariozechner/pi-coding-agent
  coding-agent CLI, sessions, built-in tools, extensions, interactive/print/json/RPC modes
```

## Interactive Mode Finding

The interactive guided mode is not the fundamental agent loop.

The CLI enters interactive mode by default when no non-interactive mode is passed.

Important modes from `packages/coding-agent/README.md`:

```text
default          interactive TUI
-p, --print      one-shot text output
--mode json      JSON event stream
--mode rpc       JSON RPC over stdin/stdout
```

That means Harmony does not need to fight the interactive UI. We can avoid it by using one of:

```bash
pi -p "prompt"
pi --mode json "prompt"
pi --mode rpc
```

For Node/TypeScript integration, the docs explicitly recommend using `AgentSession` directly instead of spawning a subprocess.

## Core Agent Loop

Primary file:

`packages/agent/src/agent-loop.ts`

The loop is compact and useful.

High-level flow:

```text
agentLoop(prompt, context, config)
  push agent_start
  push turn_start
  append user prompt

  while true:
    while tool calls or queued steering messages exist:
      transform AgentMessage[] context
      convert AgentMessage[] to LLM Message[]
      call streamSimple(model, llmContext, options)
      stream assistant message events
      collect assistant message

      if assistant has tool calls:
        execute tool calls
        append toolResult messages
        check steering messages after each tool

      push turn_end

    check follow-up messages
    if none, stop

  push agent_end
```

Important behavior:

- the loop keeps calling the LLM while tool calls exist
- tools are executed inside the agent loop
- tool results are appended as `toolResult` messages
- steering messages can interrupt after current tool execution and skip remaining tools
- follow-up messages run after the agent would otherwise stop
- output is event-stream based

## Agent Class

Primary file:

`packages/agent/src/agent.ts`

`Agent` wraps `agentLoop` and manages:

- state
- model
- system prompt
- thinking level
- tools
- messages
- streaming state
- pending tool calls
- steering queue
- follow-up queue
- abort handling

Useful methods:

```text
prompt()
continue()
steer()
followUp()
abort()
waitForIdle()
setTools()
setModel()
setSystemPrompt()
replaceMessages()
```

This is a strong candidate for direct embedding if Harmony wants full TypeScript control.

## Coding Agent SDK

Primary file:

`packages/coding-agent/src/core/sdk.ts`

The `createAgentSession()` SDK factory wraps `Agent` with:

- session management
- settings
- model registry
- auth storage
- resource loading
- system prompt construction
- built-in tools
- custom tools
- extension loading

Minimal docs example:

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: new AuthStorage(),
  modelRegistry: new ModelRegistry(authStorage),
});

await session.prompt("What files are in the current directory?");
```

This is probably the fastest route to a real Harmony adapter.

## Tools

Built-in tools live in:

`packages/coding-agent/src/core/tools/`

Available built-ins:

```text
read
bash
edit
write
grep
find
ls
```

Default coding tools:

```text
read, bash, edit, write
```

Read-only tools:

```text
read, grep, find, ls
```

Tool factories accept a `cwd`, which is useful for sandboxing:

```typescript
createReadOnlyTools(cwd)
createCodingTools(cwd)
createAllTools(cwd)
```

Some tool operations are pluggable:

- `read` can override filesystem read/access operations
- `write` can override filesystem write/mkdir operations
- `bash` can override command execution operations

This is important for Harmony because we can potentially route tool operations through Harmony policy wrappers instead of using raw local filesystem/shell behavior.

## Extensions And Policy Hooks

Pi has an extension system that can intercept tool calls.

Important file:

`packages/coding-agent/src/core/extensions/wrapper.ts`

Tool wrapping behavior:

```text
tool_call event before execution
  extension may block

actual tool executes

tool_result event after execution
  extension may modify result
```

Examples:

- `examples/extensions/permission-gate.ts`
- `examples/extensions/protected-paths.ts`

This proves pi can support permission gates internally. However, for Harmony's architecture, policy should remain owned by Harmony, not buried inside pi extensions.

Good use of pi extensions for Harmony:

- thin adapter that asks Harmony policy before a tool executes
- project-local guardrails
- event forwarding

Risky use:

- making pi extensions the primary source of business policy
- letting pi extensions own business permissions
- installing third-party packages with broad system access

## Integration Options

### Option A: Use Pi CLI Print/JSON Mode

Harmony spawns:

```bash
pi --mode json --no-session --tools read,grep,find,ls "prompt"
```

Pros:

- easiest subprocess integration
- avoids interactive mode
- JSON events are observable

Cons:

- weaker TypeScript control
- harder to inject Harmony policy before tool execution
- process management and parsing required
- less direct session control

### Option B: Use Pi RPC Mode

Harmony starts:

```bash
pi --mode rpc
```

Then sends JSON commands over stdin and receives JSON events over stdout.

Pros:

- designed for process integration
- supports prompts, steering, follow-up, abort, state, messages, model control
- avoids TUI

Cons:

- still subprocess-based
- policy interception likely requires extension hooks or restricted tools
- more protocol plumbing

### Option C: Use `@mariozechner/pi-coding-agent` SDK

Harmony imports `createAgentSession()` and uses the SDK directly.

Pros:

- best TypeScript fit
- direct access to `AgentSession`
- direct event subscription
- direct custom tool registration
- can use in-memory sessions
- easier to wrap tools with Harmony policy

Cons:

- Harmony becomes coupled to pi package APIs
- version upgrades may require adapter maintenance

### Option D: Use `@mariozechner/pi-agent-core` Directly

Harmony imports `Agent` or `agentLoop` directly.

Pros:

- closest to the dead-simple loop
- maximum control
- avoids coding-agent CLI/session complexity
- easiest to ensure Harmony owns tools and policy

Cons:

- Harmony must provide more infrastructure itself:
  - system prompts
  - model registry/auth
  - tool definitions
  - sessions
  - compaction
  - resource loading

## Current Fit Assessment

Pi is a good mental and technical starting point.

The strongest parts for Harmony:

- compact tool-calling loop
- event-stream lifecycle
- steering/follow-up queues
- SDK integration
- built-in tool factories
- extension interception
- RPC mode if we need process isolation

The biggest architectural caution:

Pi's agent loop executes tools internally. Harmony's design says agents should request authority from Harmony before tools execute. Therefore Harmony must either:

1. provide only Harmony-wrapped tools to pi, or
2. use pi extension `tool_call` hooks to call Harmony policy before execution, or
3. use `pi-agent-core` directly and own all tool definitions.

Do not hand pi unrestricted `bash`, `write`, or broad filesystem tools for Company Brain scenarios.

## Recommended Harmony Path

Recommended first path:

```text
Use pi-agent-core or pi-coding-agent SDK directly, not the interactive CLI.
Start with no built-in tools or read-only tools.
Provide Harmony-wrapped tools.
Keep LocalHarness as deterministic test harness.
Implement PiMonoHarness only behind RuntimeHarness.
```

Practical sequence:

1. Create or update a clean pi checkout.
2. Install dependencies and run `./pi-test.sh --help`.
3. Run a no-tools JSON/print smoke test with a configured model.
4. Build a small SDK spike outside Harmony core.
5. Decide whether `PiMonoHarness` should use:
   - `@mariozechner/pi-coding-agent` SDK, or
   - `@mariozechner/pi-agent-core` direct.
6. Implement only the adapter, leaving Harmony core unchanged.

## Published Package Update

The published npm packages inspected on 2026-05-02 are newer than the stale local checkout:

```text
@mariozechner/pi-agent-core: 0.72.1
@mariozechner/pi-ai: 0.72.1
```

This matters because published `pi-agent-core` has first-class hooks that are useful for Harmony:

```text
beforeToolCall
afterToolCall
toolExecution: sequential | parallel
```

That makes direct `pi-agent-core` integration stronger than the older local source suggested. Harmony can keep policy at the core loop boundary without relying on `pi-coding-agent` extensions.

## Spike Result

Spike file:

`src/spikes/pi-agent-core-spike.ts`

Run:

```bash
npm run spike:pi-core
```

What it proves:

- no API key is required
- no raw shell/write/filesystem tool is exposed
- fake model stream requests two tools
- `workspace.note` is allowed by Harmony policy
- `shell.exec` is denied by Harmony policy before execution
- pi-agent-core continues after tool results and completes the loop
- Harmony records allow/complete/deny events

Observed Harmony events:

```text
tool.allowed    workspace.note
tool.completed  workspace.note
tool.denied     shell.exec
```

This validates the preferred direction from Decision 001: use `pi-agent-core` as the loop while Harmony owns tools and policy.

## Initial Success Criteria

Milestone 1 is successful when:

- pi can run in non-interactive mode locally
- Harmony has a documented adapter choice
- Harmony can start a pi-backed agent session through `RuntimeHarness`
- the pi-backed agent cannot execute raw shell/write tools unless Harmony grants them
- pi events are translated into Harmony events

## Open Questions

1. Should Harmony depend on published npm packages or local source checkout?
2. Is process isolation important enough to prefer RPC mode over SDK embedding?
3. Do we want pi's session files or Harmony's own event/session store to be primary?
4. Should Harmony use pi's extension system for policy gates, or bypass it with Harmony-owned tools?
5. Which first real model should be used for smoke testing: API model, local model, or both?
