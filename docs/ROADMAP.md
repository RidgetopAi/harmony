# Harmony Roadmap

## Vision

Harmony is the control plane for a small-business Company Brain.

The Company Brain will eventually connect to a business's documents, communications, and operational systems, then build a trustworthy picture of how that business works. Harmony's job is to make that safe and manageable by controlling agents, permissions, connectors, tools, approvals, sandboxes, and audit logs.

Initial target customer:

- small businesses with fewer than 30 employees
- messy real-world files and communications
- limited internal IT support
- high need for trust, traceability, and safe automation

## Product Thesis

Small businesses do not need an unconstrained autonomous agent. They need a controlled system that can gradually understand their business while showing what it can see, what it did, where facts came from, and what requires human approval.

Working principles:

```text
Authority before autonomy.
Discovery before ingestion.
Provenance before answers.
Approval before action.
Audit before trust.
```

## System Planes

Harmony should keep these planes separate.

### Control Plane

The authority layer.

- agent definitions
- role and capability assignment
- policy checks
- tool brokering
- message brokering
- approvals
- sandbox boundaries
- audit events
- per-business configuration

### Runtime Plane

The execution layer.

- pi-mono adapter
- local model calls
- API model calls
- worker processes
- command execution
- background jobs

### Data Plane

The business knowledge layer.

- businesses
- sources
- source roots/scopes
- documents
- communications
- metadata
- extracted text
- entities
- relationships
- provenance
- retention/deletion state

Harmony starts with the control plane, then connects runtime and data capabilities behind explicit contracts.

## Current Baseline

Workspace:

`/home/ridgetop/projects/harmony`

Mandrel project:

`harmony`

Current version:

`0.1` TypeScript control-plane scaffold

Current proof:

- config-defined agents
- routed task
- local stub harness
- policy-checked tool calls
- policy-checked agent messages
- event log for allowed and denied actions
- Decision 001: preferred runtime loop is `pi-agent-core`
- `pi-agent-core` spike proving Harmony-owned policy before tool execution
- placeholder `PiCoreHarness` remains until the spike is promoted into the harness contract

Important prior prototype:

`/home/ridgetop/projects/mock-local-business-corpus`

That project contains the mock-business file discovery agent and fixture corpus. Keep it in place until Harmony intentionally absorbs the useful parts.

## Milestone 0: Direction Lock

Status: complete.

Goals:

- establish Harmony as the official project name
- store mock-business continuity in Mandrel
- create first runnable TypeScript scaffold
- define the control-plane mental model

Done when:

- `npm run demo` proves an agent intent can be allowed or denied through policy
- roadmap and project contracts are written
- Mandrel has a current planning context

## Milestone 1: Harness Understanding

Status: complete.

Goal:

Understand `pi-mono` well enough to decide how Harmony should wrap it.

Tasks:

- inspect local `/home/ridgetop/projects/pi-mono`
- identify why the current install enters guided/interactive mode
- inspect package scripts, entrypoints, expected CLI flags, and runtime assumptions
- decide whether to keep the existing checkout, clone a fresh side-by-side copy, or vendor/fork later
- document what pi-mono can do and what Harmony must provide itself

Key question:

```text
Is pi-mono the agent runtime, the tool/process harness, or both?
```

Done when:

- `docs/PI_MONO_NOTES.md` explains pi-mono entrypoints and integration options
- `PiCoreHarness` has a written adapter design before implementation
- no Harmony core code depends directly on pi-mono internals

Completion notes:

- inspected the local `/home/ridgetop/projects/pi-mono` checkout
- determined the local checkout is clean but stale and has no dependencies installed
- identified that pi's guided/interactive behavior is the default CLI mode, not the core loop
- documented headless modes: `-p`, `--mode json`, and `--mode rpc`
- compared `pi-coding-agent` versus `pi-agent-core`
- accepted Decision 001: use `pi-agent-core` as the preferred long-term runtime loop
- discovered published `@mariozechner/pi-agent-core@0.72.1` has `beforeToolCall` and `afterToolCall` hooks
- built `src/spikes/pi-agent-core-spike.ts`
- proved Harmony policy can allow `workspace.note` and deny `shell.exec` before execution

Important caveat:

We did not make the stale local pi CLI checkout runnable because dependencies are missing and the published package path is a better fit for Harmony. The original "run pi non-interactively" criterion is superseded by the stronger spike: Harmony ran `pi-agent-core` directly with no API key, no raw privileged tools, and Harmony-owned policy at the loop boundary.

## Milestone 2: Runtime Harness Contract

Status: complete.

Goal:

Make the runtime boundary real and stable.

Tasks:

- refine `RuntimeHarness`
- define session lifecycle states
- define agent input/output envelopes
- define error and timeout behavior
- define streaming versus batch output behavior
- keep `LocalHarness` as a deterministic test harness
- add contract tests for any harness implementation

Done when:

- `LocalHarness` and `PiCoreHarness` can satisfy the same interface shape
- tests prove a harness cannot bypass policy by directly executing tools
- every harness output becomes structured agent intent before action

Progress notes:

- added explicit `AgentSession` lifecycle state and `harnessName`
- wrapped harness execution in `RuntimeRunResult`
- defined completed, failed, and timed-out runtime result states
- defined batch versus stream output mode at the contract boundary
- required completed output to be `format: structured-intent`
- added contract tests proving LocalHarness output still goes through `ToolBroker` and policy before tool execution
- renamed the placeholder adapter to `PiCoreHarness` to match Decision 001
- added runtime validation that rejects malformed completed harness output as `invalid_output`
- added concrete timeout behavior in `LocalHarness`
- implemented `PiCoreHarness` behind the same `RuntimeHarness` contract using inert pi-agent-core intent tools
- added shared contract tests proving both `LocalHarness` and `PiCoreHarness` cannot bypass Harmony policy
- verified pi-agent-core tool calls become structured Harmony `AgentAction` intent before brokered action

Completion notes:

- `LocalHarness` remains the deterministic test harness.
- `PiCoreHarness` runs `@mariozechner/pi-agent-core` without real model keys by using an injectable stream function and deterministic default fake stream.
- `PiCoreHarness` does not expose raw privileged tools. Its pi tools are inert and only let the pi loop complete while Harmony captures requested tool calls as intent.
- Real tool execution remains outside the harness and still flows through `ToolBroker`.

## Milestone 3: Agent Protocol

Status: complete.

Goal:

Define how real agents express intent.

Tasks:

- design the structured action schema for tool calls and messages
- decide how model text becomes typed `AgentAction`
- add validation for all agent outputs
- reject malformed actions with logged events
- keep human-readable content separate from machine-readable intent

Example shape:

```text
agent response
  content: human-readable reasoning/result
  actions:
    - tool request
    - message request
```

Done when:

- a real or simulated model output can be parsed into validated actions
- invalid action payloads are denied and logged
- prompts clearly teach agents to request authority rather than assume it

Progress notes:

- extracted `AgentAction` and `AgentOutput` into a protocol module
- added machine-readable protocol schema constants for output, tool actions, and message actions
- added parsing for structured model objects and JSON model text
- explicitly rejected free-form model text at the protocol boundary
- added protocol issue codes for malformed output and malformed actions
- added `agent.action_invalid` audit events before broker execution
- added contract tests proving malformed actions cannot trigger tools or messages
- added shared authority-request protocol instructions to configured agent prompts
- added tests proving configured agents carry the protocol guidance

## Milestone 4: Policy Model

Status: complete.

Goal:

Move from basic allowlists to a small but serious permission system.

Tasks:

- define capabilities by namespace, such as `filesystem.read`, `filesystem.write`, `shell.exec`, `git.diff`
- add path/resource scopes
- add tool risk levels
- add approval requirements
- add policy denial reasons
- define per-business policy overrides

Important rule:

Agents never own raw credentials, filesystem authority, shell authority, or connector authority. They only request actions from Harmony.

Done when:

- policy can answer "who can do what to which resource under which business"
- denials are explainable
- approval-required actions are distinct from denied actions

Progress notes:

- added a typed `PolicyDecision` contract with `decision`, `allowed`, `reason`, `agentId`, `action`, `resource`, and `policyRuleId`
- added explicit capability namespace derivation for known capabilities including `filesystem.read`, `filesystem.write`, `shell.exec`, and `git.diff`
- allowed agents to receive exact tool grants or broader capability namespace grants while preserving permission gates
- expanded tool and message policy events with decision metadata for explainable audit records
- added policy model contract tests for namespace derivation, exact grants, namespace grants, allowlist denials, permission-gate denials, and broker denial event metadata
- added `approval_required` tool policy decisions using `AgentPermissions.requiresApprovalFor`
- added `tool.approval_required` events and broker behavior that does not execute handlers while approval is pending
- added tests proving approval-required actions are distinct from denied actions and that denials take precedence when allowlist or permission gates fail
- added `AgentResourceScope` with filesystem path scopes and read/write/read_write access
- required filesystem tool inputs to include a scoped path before approval or execution
- normalized filesystem paths before scope checks to prevent traversal outside approved roots
- added tests for missing path denials, out-of-scope path denials, normalized in-scope paths, and traversal attempts
- added tool risk levels as policy metadata: low, medium, high, and critical
- mapped shell execution to critical risk, filesystem writes to high risk, filesystem reads to medium risk, and git diff/default tools to low risk
- included risk levels in policy actions/resources and audit event metadata
- added `BusinessPolicyOverride` records keyed by `businessId` and `agentId`
- supported per-business allowed tools, denied tools, approval requirements, and resource scopes
- made business override denials take precedence over base agent grants
- added tests for business-scoped grants, explicit business denials, business approval requirements, and business-owned resource scopes

## Milestone 5: Durable Event Log

Status: complete.

Goal:

Turn the current in-memory event log into a trustworthy audit surface.

Tasks:

- define event types and event payload contracts
- choose a first persistence layer
- store task, agent, policy, message, tool, approval, and connector events
- include business identity and source identity where applicable
- add event query helpers

Progress notes:

- added typed payload contracts for task, agent, tool, policy, message, approval, and connector event families
- added top-level event identity fields for business, source, source root/scope, task, session, and correlation IDs
- added event query helpers for type, actor, target, business, source, task, session, time range, sort order, and limit
- made event reads return defensive copies so callers cannot mutate stored audit history
- chose JSONL as the first durable persistence layer through `JsonlEventStore`
- added reload support so persisted events are queryable after creating a new `EventLog`
- added `policy.decision_recorded` events before broker allowed, denied, and approval-required outcomes
- wired task/session identity through orchestrator events
- wired business/source identity through tool and message broker event contexts
- added contract tests proving denied, approval-required, approval, connector, and persisted events remain queryable

Done when:

- every meaningful action has an event
- denied actions are persisted
- future UI/API can answer what happened, when, by whom, and why

## Milestone 6: Business And Source Model

Status: complete.

Goal:

Create the foundation for Company Brain data boundaries.

Core entities:

- Business
- Agent
- Source
- SourceRoot or SourceScope
- Connector
- Document
- Communication
- DiscoveryJob
- Approval
- ProvenanceRecord
- AuditEvent

Tasks:

- define TypeScript domain types first
- document naming and IDs
- reuse lessons from mock-business where useful
- avoid deep indexing until discovery/approval is stable

Progress notes:

- created `src/domain/business-source-model.ts` for the first data-boundary contracts
- defined Business, business agent assignment, Source, SourceRoot, SourceScope, Connector, Document, Communication, DiscoveryJob, Approval, ProvenanceRecord, and AuditEvent reference types
- made source access explicit through approved SourceRoot or SourceScope records
- added `defineDocument` and `defineCommunication` contract helpers requiring at least one matching provenance record
- added contract tests for multi-source businesses, scoped access, document provenance, and communication provenance

Done when:

- a business can have multiple configured sources
- source access is explicit and scoped
- no document exists without business/source provenance

## Milestone 7: File Discovery Agent Integration

Status: in progress.

Goal:

Bring the mock-business discovery work into Harmony as the first realistic controlled agent scenario.

Tasks:

- review `mock-local-business-corpus`
- extract or port shared discovery schemas/logic as needed
- define a `file-discovery-agent`
- grant read-only filesystem access to approved roots
- run discovery through Harmony's tool/policy/event path
- log scan summaries and errors
- preserve discovery-first, approval-second flow

Progress notes:

- local `/home/ridgetop/projects/mock-local-business-corpus` path is absent; source fixture is on desktop and can be pulled over Tailscale when needed
- added `file-discovery-agent` as a controlled read-only discovery agent
- added brokered `discovery.scanRoot` tool backed by filesystem scanning
- mapped `discovery.scanRoot` to the `filesystem.read` policy capability so approved root scopes apply before execution
- scan output returns `Document` records with M6 provenance and pending approval status
- scan output includes summary counts and per-entry errors so one broken or unreadable entry does not fail the whole scan
- added contract tests for discovery task routing, approved-root scanning, out-of-scope denial, event identity, metadata, provenance, and broken-entry resilience
- inspected desktop `mock-local-business-corpus` over Tailscale and ported discovery-only scanner ideas: noisy-directory skips, deterministic file IDs, SHA-256 hashes, usefulness scores, classifications, duplicate groups, folder rollups, file-type breakdowns, and source-area breakdowns
- validated Harmony scanner against a temporary local copy of the Green Ridge corpus: 319 files, 68 folders, 536824 bytes, 2 duplicate groups, 4 duplicate files, 75 recommended, 83 review, 158 archive, 2 duplicate, 1 skip, 0 errors

Done when:

- Harmony can assign a discovery task to a controlled agent
- the agent can scan only approved roots
- scan results include metadata and provenance
- one bad/unreadable file cannot fail the whole scan

## Milestone 8: Approval Workflow

Goal:

Add the first human control point.

Tasks:

- represent approvals as durable records
- support approve/deny/defer states
- connect approvals to discovered files, folders, sources, and tool actions
- require approval before deep parsing/indexing
- require approval before risky tool actions

Done when:

- discovery can happen without deep ingestion
- users can approve what gets indexed
- approval decisions are auditable

## Milestone 9: Company Brain Data Ingestion

Goal:

Start turning approved documents into useful knowledge.

Tasks:

- parse approved files
- extract text
- store chunks
- attach provenance to every chunk
- add entity extraction experiments
- defer broad RAG until provenance and approval are reliable

Done when:

- approved documents can be parsed into traceable records
- answers can cite source documents
- deletion/retention is still possible

## Milestone 10: Small Business Brain MVP

Goal:

Deliver the first coherent end-to-end Company Brain workflow.

Scenario:

1. Configure a business.
2. Configure one local filesystem source.
3. Run discovery.
4. Review discovered files.
5. Approve a subset.
6. Parse/index approved documents.
7. Ask simple questions with citations.
8. Inspect audit history.

Done when:

- the system can explain what it knows and where it learned it
- users can see what was scanned, approved, indexed, and queried
- agents remain controlled by Harmony policies

## Drift Control

These are explicit non-goals until their milestone arrives:

- autonomous long-running agents
- broad internet access
- production SaaS multi-tenancy
- complex UI
- vector search before approval/provenance
- connectors beyond local filesystem before source contracts stabilize
- write actions into customer systems

If a new idea appears, classify it as one of:

- current milestone
- next milestone
- later backlog
- rejected for now

Do not implement it until it has a home.

## Near-Term Working Scope

Next recommended work block:

1. Inspect `pi-mono`.
2. Write `docs/PI_MONO_NOTES.md`.
3. Refine `RuntimeHarness` based on what pi-mono actually supports.
4. Add a minimal test harness around the control boundary.
5. Only then implement the first `PiCoreHarness` adapter.
