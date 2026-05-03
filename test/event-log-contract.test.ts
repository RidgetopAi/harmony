import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { EventLog } from "../src/events/event-log.js";
import { JsonlEventStore } from "../src/events/event-store.js";
import type { HarmonyEvent } from "../src/events/event-types.js";

test("event log records stable ids timestamps and queryable identity metadata", () => {
  const events = new EventLog();

  const taskEvent = events.record({
    type: "task.created",
    data: {
      taskId: "task-1",
      content: "Build the durable event log."
    }
  });

  const deniedEvent = events.record({
    type: "tool.denied",
    actorId: "agent-1",
    businessId: "business-1",
    sourceRootId: "source-root-1",
    data: {
      toolName: "shell.exec",
      decision: "denied",
      reason: "agent-1 cannot run shell commands",
      policyRuleId: "permission.shell.exec",
      action: {
        type: "tool",
        name: "shell.exec",
        capability: "shell.exec",
        riskLevel: "critical"
      },
      resource: {
        type: "tool",
        name: "shell.exec",
        capability: "shell.exec",
        riskLevel: "critical"
      }
    }
  });

  assert.match(taskEvent.id, /^[0-9a-f-]{36}$/);
  assert.ok(taskEvent.at instanceof Date);
  assert.equal(taskEvent.taskId, "task-1");
  assert.equal(deniedEvent.businessId, "business-1");
  assert.equal(deniedEvent.sourceRootId, "source-root-1");

  assert.deepEqual(
    events.list({ type: "task.created" }).map((event) => event.id),
    [taskEvent.id]
  );
  assert.deepEqual(
    events.list({ type: "tool.denied", actorId: "agent-1", businessId: "business-1" }).map(
      (event) => event.id
    ),
    [deniedEvent.id]
  );
  assert.equal(events.findById(deniedEvent.id)?.type, "tool.denied");
});

test("event log preserves denied and approval-required events for audit queries", () => {
  const events = new EventLog();
  const from = new Date(Date.now() - 1_000);

  const deniedEvent = events.record({
    type: "tool.denied",
    actorId: "agent-1",
    data: {
      toolName: "filesystem.readFile",
      decision: "denied",
      reason: "agent-1 cannot access /private/payroll.txt with filesystem.read",
      policyRuleId: "resource.scope",
      action: {
        type: "tool",
        name: "filesystem.readFile",
        capability: "filesystem.read",
        riskLevel: "medium"
      },
      resource: {
        type: "tool",
        name: "filesystem.readFile",
        capability: "filesystem.read",
        riskLevel: "medium",
        path: "/private/payroll.txt"
      }
    }
  });

  const approvalEvent = events.record({
    type: "tool.approval_required",
    actorId: "agent-1",
    businessId: "business-1",
    data: {
      toolName: "filesystem.writeFile",
      decision: "approval_required",
      reason: "agent-1 requires approval to use filesystem.writeFile (filesystem.write)",
      policyRuleId: "tool.approval_required",
      action: {
        type: "tool",
        name: "filesystem.writeFile",
        capability: "filesystem.write",
        riskLevel: "high"
      },
      resource: {
        type: "tool",
        name: "filesystem.writeFile",
        capability: "filesystem.write",
        riskLevel: "high",
        path: "/business/docs/report.txt"
      },
      businessId: "business-1"
    }
  });

  const auditEvents = events.list({
    type: ["tool.denied", "tool.approval_required"],
    from,
    sort: "desc",
    limit: 2
  });

  assert.deepEqual(
    auditEvents.map((event) => event.id),
    [approvalEvent.id, deniedEvent.id]
  );
  const firstAuditEvent = auditEvents[0];
  assert.equal(firstAuditEvent.type, "tool.approval_required");

  if (firstAuditEvent.type !== "tool.approval_required") {
    throw new Error("Expected approval-required audit event.");
  }

  assert.equal(firstAuditEvent.data.decision, "approval_required");
  assert.equal(events.list({ businessId: "business-1" })[0].id, approvalEvent.id);
});

test("event log returns defensive copies instead of mutable stored events", () => {
  const events = new EventLog();
  const saved = events.record({
    type: "message.denied",
    actorId: "agent-1",
    targetId: "agent-2",
    data: {
      reason: "agent-1 cannot message agent-2"
    }
  });

  saved.at.setFullYear(1999);
  (saved as HarmonyEvent<"message.denied">).data.reason = "mutated";

  const stored = events.findById(saved.id);

  assert.ok(stored);
  assert.equal(stored.type, "message.denied");

  if (stored.type !== "message.denied") {
    throw new Error("Expected message denial event.");
  }

  assert.notEqual(stored.at.getFullYear(), 1999);
  assert.equal(stored.data.reason, "agent-1 cannot message agent-2");
});

test("JSONL event store persists and reloads audit events", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-events-"));
  const filePath = path.join(directory, "events.jsonl");

  try {
    const events = new EventLog(new JsonlEventStore(filePath));

    const taskEvent = events.record({
      type: "task.created",
      data: {
        taskId: "task-1",
        content: "Persist audit history."
      }
    });

    const approvalEvent = events.record({
      type: "approval.requested",
      actorId: "agent-1",
      data: {
        approvalId: "approval-1",
        status: "pending",
        targetType: "toolAction",
        targetId: "tool-call-1",
        requestedByAgentId: "agent-1",
        reason: "filesystem write needs approval",
        businessId: "business-1",
        sourceId: "source-1",
        sourceRootId: "source-root-1"
      }
    });

    const connectorEvent = events.record({
      type: "connector.discovery_completed",
      actorId: "connector-runner",
      data: {
        connectorId: "connector-1",
        lifecycle: "discovered",
        businessId: "business-1",
        sourceId: "source-1",
        sourceRootId: "source-root-1",
        counts: {
          documents: 3
        }
      }
    });

    const reloaded = new EventLog(new JsonlEventStore(filePath));

    assert.deepEqual(
      reloaded.list().map((event) => event.id),
      [taskEvent.id, approvalEvent.id, connectorEvent.id]
    );
    assert.equal(reloaded.findById(taskEvent.id)?.at instanceof Date, true);
    assert.deepEqual(
      reloaded.list({ businessId: "business-1", sourceId: "source-1" }).map((event) => event.id),
      [approvalEvent.id, connectorEvent.id]
    );
    assert.deepEqual(
      reloaded.list({ type: "approval.requested" }).map((event) => event.id),
      [approvalEvent.id]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
