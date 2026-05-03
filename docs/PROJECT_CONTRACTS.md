# Harmony Project Contracts

This document exists to keep the project from drifting into spaghetti. When in doubt, follow these contracts before adding new concepts.

## Core Vocabulary

Use these names consistently.

### Harmony

The control plane. Harmony owns authority, routing, policy, approvals, and audit.

Harmony is not the Company Brain itself. Harmony lets the Company Brain operate safely.

### Company Brain

The product capability built on top of Harmony. It understands a business through documents, communications, sources, entities, and workflows.

### Harness

The execution substrate. A harness starts sessions, runs agent work, receives messages, and reports outputs. `pi-mono` should be wrapped as a harness adapter.

### Agent

A configured role with a model, prompt, permissions, allowed tools, and allowed communication targets.

### Tool

A controlled capability exposed through Harmony. Examples: filesystem read, shell command, git diff, source scan, document parse, connector sync.

### Source

A business data origin. Examples: local filesystem, Google Drive, email, QuickBooks, Slack, Teams, CRM.

### SourceRoot / SourceScope

The approved subset of a source that Harmony may inspect. For local files this may be a directory root. For SaaS connectors this may be a folder, label, mailbox, channel, or API scope.

### Document

A discovered or ingested business file-like object. A document must always belong to a business and source.

### Communication

A message-like business object, such as email, chat, SMS, or call transcript.

### Provenance

The source trail for a fact, chunk, summary, or answer.

### Event

An auditable record of something Harmony observed, allowed, denied, executed, or delivered.

## Naming Rules

Use these terms in code, docs, and Mandrel.

- `Business`, not tenant, account, org, or workspace unless specifically discussing SaaS packaging.
- `Source`, not connector instance, integration, provider, or drive.
- `SourceRoot` for local filesystem roots.
- `SourceScope` for non-filesystem scopes.
- `Document` for file-like objects.
- `Communication` for message-like objects.
- `AgentDefinition` for configured agent metadata.
- `AgentSession` for a running harness session.
- `AgentAction` for requested intent from an agent.
- `ToolCall` or tool action for a requested tool use.
- `PolicyDecision` for allow/deny/approval-required results.
- `RuntimeHarness` for the interface Harmony uses.
- `PiCoreHarness` for the adapter around `@mariozechner/pi-agent-core`.

IDs should be explicit:

- `businessId`
- `agentId`
- `sessionId`
- `taskId`
- `sourceId`
- `sourceRootId`
- `sourceScopeId`
- `documentId`
- `communicationId`
- `eventId`
- `approvalId`

Avoid vague IDs like `id` in cross-boundary payloads unless the type is already obvious.

## Boundary Rules

### Agents Do Not Own Power

Agents may produce intent. They may not directly execute privileged work.

Allowed:

```text
agent -> Harmony -> policy check -> broker -> tool/harness
```

Not allowed:

```text
agent -> shell
agent -> filesystem
agent -> connector credential
agent -> another agent directly
```

### Harnesses Do Not Own Policy

Harnesses execute. They should not decide business permissions.

If a harness can call tools, Harmony must still broker or restrict those tools.

### Tools Do One Thing

Each tool should have a narrow contract.

Good:

- `filesystem.readFile`
- `filesystem.listDirectory`
- `git.diff`
- `discovery.scanRoot`

Too broad:

- `filesystem.manage`
- `business.doEverything`
- `agent.runAnything`

### Messages Are Capabilities

Agent-to-agent communication is a permissioned action. It must go through `MessageBroker`.

### Events Are Truth

Every allowed, denied, executed, failed, or approval-required action should produce an event.

## Durable Event Log Contract

`EventLog` is the audit surface for Harmony. It owns event IDs, timestamps, query behavior, defensive copies, and persistence through an `EventStore`.

Current stores:

```text
MemoryEventStore
JsonlEventStore
```

`JsonlEventStore` is the first durable persistence layer. It writes one event per line, reloads events at startup, and preserves timestamps as `Date` values when read back through `EventLog`. This keeps Milestone 5 append-only and dependency-free until a later API/database milestone needs stronger indexing or multi-process guarantees.

Every event includes:

```text
id
type
at
actorId when applicable
targetId when applicable
businessId when applicable
sourceId when applicable
sourceRootId when applicable
sourceScopeId when applicable
taskId when applicable
sessionId when applicable
correlationId when applicable
data
```

Current event families:

```text
task.*
agent.*
tool.*
policy.*
message.*
approval.*
connector.*
```

Task events carry task identity. Agent events carry session/output or failure details. Tool, policy, and message policy events carry decision state, action, resource, reason, and policy rule ID when available. Approval and connector event payloads include business and source identity so future UI/API surfaces can answer what happened, when, by whom, and why.

Tool and message brokers also record `policy.decision_recorded` before allowed, denied, or approval-required broker events. This keeps policy decisions queryable even when the downstream action does not execute.

The event log supports audit queries by:

```text
type
actorId
targetId
businessId
sourceId
sourceRootId
sourceScopeId
taskId
sessionId
correlationId
time range
sort order
limit
```

Denied and approval-required events must remain queryable and must not be collapsed into generic failures. Event log reads return defensive copies so callers cannot mutate stored audit history.

## Business And Source Model Contract

Milestone 6 owns the first typed data-boundary model in `src/domain/business-source-model.ts`.

Core entities:

```text
Business
BusinessAgentAssignment
Source
SourceRoot
SourceScope
Connector
Document
Communication
DiscoveryJob
Approval
ProvenanceRecord
AuditEventReference
```

Identity is explicit. Data-plane objects should use stable named IDs such as `businessId`, `sourceId`, `sourceRootId`, `sourceScopeId`, `documentId`, `communicationId`, `discoveryJobId`, `approvalId`, `provenanceId`, and `eventId`.

Source access is not implied by configuring a source or connector. Access exists only through approved scoped records:

```text
SourceRoot for local filesystem roots
SourceScope for folders, labels, mailboxes, channels, API scopes, or accounts
```

A `Document` or `Communication` must carry `businessId`, `sourceId`, exactly one of `sourceRootId` or `sourceScopeId`, and at least one matching `ProvenanceRecord`. The provenance record must point back to the same business, source, and source root or scope. This rule is enforced by the current contract helpers:

```text
defineDocument
defineCommunication
sourceAccessFor
sourcesForBusiness
```

Do not let connector lifecycle state substitute for source authorization. A connector may be configured or connected while its roots/scopes are still pending review.

## Data Contracts

Every business data object should eventually include:

```text
businessId
sourceId
sourceRootId or sourceScopeId when applicable
createdAt or discoveredAt
updatedAt when applicable
provenance
```

Every discovered document should include:

```text
documentId
businessId
sourceId
sourceRootId or sourceScopeId
path or externalRef
name
mimeType or extension
sizeBytes
discoveredAt
discoveryStatus
approvalStatus
provenance
```

Every extracted fact/chunk/summary should include:

```text
businessId
sourceId
documentId or communicationId
extractedByAgentId
extractedAt
confidence
provenance
```

No answer should be treated as trustworthy unless it can cite provenance.

Provenance chains are structural, not optional. If a workflow discovers a business object, it must also create the matching provenance write path in the same slice. Do not add tables, types, or agent outputs that produce documents, communications, facts, chunks, summaries, or answers without a corresponding provenance path and validation test.

## Policy Decision Contract

Policy returns a typed `PolicyDecision` with a stable decision state:

```text
allowed
denied
approval_required
```

Each decision includes:

```text
decision
allowed
reason
agentId
action
resource
businessId when applicable
policyRuleId when available
```

Do not collapse approval-required into denied. They mean different things.

Tool policy actions include a capability namespace derived from the tool name. Current known namespaces include:

```text
filesystem.read
filesystem.write
shell.exec
git.diff
```

Concrete tool names may be granted directly, or an agent may be granted a namespace. For example, a grant for `filesystem.read` can cover concrete read tools such as `filesystem.readFile`, but the relevant file-read permission gate must still pass.

Tool policy actions also include a risk level:

```text
low
medium
high
critical
```

Current defaults:

```text
shell.exec -> critical
filesystem.write -> high
filesystem.read -> medium
git.diff -> low
all other tools -> low
```

Policy denial events must carry enough metadata to explain what failed: decision state, reason, action, resource, and policy rule ID.

Approval-required decisions are separate from denials. Current tool policy ordering is:

```text
allowlist or namespace grant
permission gate
approval requirement
allowed
```

If a tool action needs approval, Harmony records `tool.approval_required` and does not execute the tool handler. Durable approval records and human review workflows belong to the Approval Workflow milestone.

Filesystem tools also require resource scopes. A filesystem tool decision must include a path from tool input and must match an agent `filesystem.path` scope with compatible access:

```text
read -> read or read_write scope
write -> write or read_write scope
```

Paths are normalized before scope checks so traversal such as `../` cannot escape an approved root. Missing paths fail with `resource.path_required`; out-of-scope paths fail with `resource.scope`.

Per-business policy overrides are configuration records keyed by `businessId` and `agentId`. Current override fields are:

```text
allowedTools
deniedTools
requiresApprovalFor
resourceScopes
```

Business override denials take precedence over base agent grants. Business override grants and approval requirements can match exact tool names, capability namespaces, or `*`. Business resource scopes are merged with the agent's base scopes only when the policy context includes the matching `businessId`.

## Approval Contract

Approvals are first-class records.

Approval states:

- `pending`
- `approved`
- `denied`
- `deferred`
- `expired`

Approval targets may include:

- source
- source root
- source scope
- discovered document
- folder
- tool action
- agent action
- deep indexing job

## Connector Contract

Every connector/source must support discovery before ingestion.

Minimum connector lifecycle:

```text
configured
connected
discovered
reviewed
approved
ingested
paused
revoked
deleted
```

Early connectors should be read-only. Write-back is a later capability.

## File Discovery Contract

Milestone 7 introduces the first controlled discovery tool:

```text
discovery.scanRoot
```

`discovery.scanRoot` is a filesystem read capability. Policy treats it as `filesystem.read`, so it must include `path` in tool input, the requesting agent must have read permission, and the path must be inside an approved `filesystem.path` resource scope.

The configured discovery agent is:

```text
file-discovery-agent
```

It may request `discovery.scanRoot`; it may not write files or run shell commands.

Discovery output must stay discovery-first and approval-second. A scan may report file metadata and provenance, but it must not parse, summarize, index, answer from, or deeply ingest file contents.

Every discovered file becomes a `Document` with:

```text
businessId
sourceId
sourceRootId
path
externalRef
name
mimeType or extension when known
sizeBytes
discoveredAt
discoveryStatus: discovered
approvalStatus: pending
provenance
```

One unreadable or broken entry must not fail the whole scan. The tool should return discovered documents plus per-entry errors and scan summary counts. Root-level policy denial still fails closed before the tool handler runs.

## Runtime Harness Contract

Harmony talks to harnesses through `RuntimeHarness`.

The runtime harness should be responsible for:

- starting agent sessions
- sending tasks/messages to an agent runtime
- returning structured output, with raw output attached only as supporting evidence
- reporting errors, timeouts, and lifecycle state

The runtime harness should not be responsible for:

- deciding permissions
- deciding business data access
- bypassing tool brokers
- storing final business knowledge

Current runtime contract shape:

```text
RuntimeHarness
  startAgentSession(agent) -> AgentSession
  runTask(session, task, options?) -> RuntimeRunResult
  receiveMessage(session, message, options?) -> RuntimeRunResult

AgentSession
  id
  agentId
  harnessName
  state: starting | running | completed | failed | timed_out | stopped
  startedAt
  lastActiveAt
  endedAt?

RuntimeRunResult
  status: completed | failed | timed_out
  outputMode: batch | stream
  durationMs
  output? structured AgentOutput
  error? RuntimeError

AgentOutput
  format: structured-intent
  agentId
  content
  actions[]
  rawOutput?
```

Important rule:

```text
Harness output is intent, not authority.
```

Even if a harness produces a tool action, Harmony must route that action through `ToolBroker` and policy before any tool handler runs. Contract tests should preserve this boundary for every harness implementation.

For `PiCoreHarness`, pi-agent-core tools must be inert intent-capture tools unless they are explicitly brokered through Harmony. The adapter may use pi-agent-core to run the model/tool-call loop, but it must return Harmony `AgentAction` intent instead of performing privileged work itself.

## Agent Protocol Contract

Agent-facing output uses the `structured-intent` protocol.

Model text must parse as JSON matching the agent protocol. Human-readable prose belongs in `content`; machine-readable requests belong in `actions`.

Agent prompts must teach this boundary directly. A prompt may describe the agent's role, but it must also tell the agent to respond with `structured-intent`, put human-readable text in `content`, put requests in `actions`, and request authority instead of claiming direct execution.

Current action forms:

```text
ToolAction
  type: tool
  toolName
  input

MessageAction
  type: message
  toAgentId
  content
```

Important rule:

```text
Agent content is not authority. Agent actions are requests for authority.
```

Malformed output or malformed actions must fail closed before `ToolBroker` or `MessageBroker` can execute work. Malformed actions should record `agent.action_invalid` with the action index and issue code, followed by `agent.run_failed` with `invalid_output`.

## Source Of Truth Order

When deciding what to build, follow this order:

1. `docs/ROADMAP.md`
2. `docs/PROJECT_CONTRACTS.md`
3. `ARCHITECTURE.md`
4. current Mandrel context for project `harmony`
5. source code

If source code disagrees with the contracts, either update the code or explicitly update the contract.

## Mandrel Usage

Store durable project state in Mandrel under project `harmony`.

Use Markdown for:

- handoffs
- milestone completions
- architecture decisions
- bug lessons
- scope changes

Use tags consistently:

- `harmony`
- `roadmap`
- `architecture`
- `decision`
- `handoff`
- `pi-mono`
- `control-plane`
- `company-brain`
- `mock-business`

## Change Discipline

Before adding a new module, ask:

1. Which plane is this: control, runtime, or data?
2. Which milestone owns this?
3. What is the typed contract?
4. What authority does it need?
5. What event should it emit?
6. What provenance should it preserve?

If the answer is unclear, write the contract before writing code.
