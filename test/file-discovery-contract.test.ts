import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agents } from "../src/config/agents.js";
import { createToolRegistry } from "../src/config/tools.js";
import { PolicyEngine } from "../src/control/policy-engine.js";
import { TaskRouter } from "../src/control/task-router.js";
import type { BusinessDocument } from "../src/domain/business-source-model.js";
import { EventLog } from "../src/events/event-log.js";
import type { ToolEventPayload } from "../src/events/event-types.js";
import type { DiscoveryScanRootOutput } from "../src/discovery/file-discovery.js";
import { ToolBroker } from "../src/tools/tool-broker.js";

test("task router assigns discovery work to the file-discovery-agent", () => {
  const router = new TaskRouter(agents);

  const agent = router.route({
    id: "task-discovery",
    content: "Scan the approved source root for business documents."
  });

  assert.equal(agent.id, "file-discovery-agent");
  assert.deepEqual(agent.allowedTools, ["discovery.scanRoot"]);
  assert.equal(agent.permissions.canReadFiles, true);
  assert.equal(agent.permissions.canWriteFiles, false);
});

test("discovery.scanRoot scans approved roots through policy broker and records provenance", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-discovery-"));

  try {
    await mkdir(path.join(directory, "ops"));
    await mkdir(path.join(directory, "node_modules"));
    writeFileSync(path.join(directory, "invoice.txt"), "invoice");
    writeFileSync(path.join(directory, "ops", "notes.md"), "# Notes");
    writeFileSync(path.join(directory, "ops", "invoice copy.txt"), "invoice");
    writeFileSync(path.join(directory, "node_modules", "noise.txt"), "noise");
    symlinkSync(path.join(directory, "missing.txt"), path.join(directory, "broken-link.txt"));

    const { result, events } = await executeDiscovery(directory);
    const output = result.output as DiscoveryScanRootOutput;
    const secondScan = (await executeDiscovery(directory)).result.output as DiscoveryScanRootOutput;
    const policyEvent = events.list({ type: "policy.decision_recorded" })[0];
    const completedEvent = events.list({ type: "tool.completed" })[0];

    assert.equal(result.ok, true);
    assert.ok(policyEvent);
    assert.ok(completedEvent);
    assert.equal(policyEvent.businessId, "business-1");
    assert.equal(policyEvent.sourceId, "source-1");
    assert.equal(policyEvent.sourceRootId, "source-root-1");
    assert.equal(policyEvent.type, "policy.decision_recorded");
    assert.equal(completedEvent.type, "tool.completed");
    assert.equal(completedEvent.data.toolName, "discovery.scanRoot");
    assert.equal(completedEvent.data.sourceRootId, "source-root-1");
    assert.equal(output.summary.businessId, "business-1");
    assert.equal(output.summary.sourceId, "source-1");
    assert.equal(output.summary.sourceRootId, "source-root-1");
    assert.equal(output.summary.filesDiscovered, 3);
    assert.equal(output.summary.directoriesVisited, 2);
    assert.equal(output.summary.skippedEntries, 1);
    assert.equal(output.summary.errors, 1);
    assert.equal(output.summary.duplicateGroups, 1);
    assert.equal(output.summary.duplicateFiles, 2);
    assert.deepEqual(output.summary.fileTypeBreakdown, {
      ".md": 1,
      ".txt": 2
    });
    assert.deepEqual(output.summary.sourceAreaBreakdown, {
      Other: 3
    });
    assert.equal(output.summary.classificationBreakdown.recommended, 1);
    assert.equal(output.summary.classificationBreakdown.review, 1);
    assert.equal(output.summary.classificationBreakdown.duplicate, 1);
    assert.equal(output.documents.length, 3);
    assert.equal(output.fileRecords.length, 3);
    assert.equal(output.duplicateGroups.length, 1);
    assert.equal(output.folderRollups.length, 2);
    assert.equal(output.errors.length, 1);
    assert.ok(output.errors[0].path.endsWith("broken-link.txt"));

    const documentNames = output.documents.map((document) => document.name).sort();
    const invoiceRecord = output.fileRecords.find((record) => record.name === "invoice.txt");
    const invoiceCopyRecord = output.fileRecords.find((record) => record.name === "invoice copy.txt");
    const secondInvoiceRecord = secondScan.fileRecords.find((record) => record.name === "invoice.txt");
    const rootRollup = output.folderRollups.find((folder) => folder.path === "");
    const opsRollup = output.folderRollups.find((folder) => folder.path === "ops");

    assert.deepEqual(documentNames, ["invoice copy.txt", "invoice.txt", "notes.md"]);
    assert.ok(invoiceRecord);
    assert.ok(invoiceCopyRecord);
    assert.ok(secondInvoiceRecord);
    assert.equal(invoiceRecord.documentId, secondInvoiceRecord.documentId);
    assert.equal(invoiceRecord.classification, "recommended");
    assert.equal(invoiceRecord.usefulnessScore, 85);
    assert.match(invoiceRecord.contentHash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(invoiceCopyRecord.classification, "duplicate");
    assert.ok(invoiceCopyRecord.classificationReasons.includes("duplicate_content_hash"));
    assert.equal(output.duplicateGroups[0].canonicalDocumentId, invoiceRecord.documentId);
    assert.ok(rootRollup);
    assert.ok(opsRollup);
    assert.equal(rootRollup.suggestedAction, "include");
    assert.equal(opsRollup.totalFiles, 2);
    assert.equal(opsRollup.duplicateCount, 1);

    for (const document of output.documents) {
      assertDocumentProvenance(document);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discovery.scanRoot is denied outside approved source roots", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-discovery-denied-"));

  try {
    const approvedPath = path.join(directory, "approved");
    const privatePath = path.join(directory, "private");
    await mkdir(approvedPath);
    await mkdir(privatePath);
    writeFileSync(path.join(privatePath, "payroll.txt"), "private");

    const { result, events } = await executeDiscovery(privatePath, approvedPath);
    const deniedEvent = events.list({ type: "tool.denied" })[0];

    assert.equal(result.ok, false);
    assert.match(String(result.output), /cannot access/);
    assert.equal(events.list({ type: "tool.completed" }).length, 0);
    assert.ok(deniedEvent);
    assert.equal(deniedEvent.type, "tool.denied");

    const data = deniedEvent.data as ToolEventPayload;

    assert.equal(data.toolName, "discovery.scanRoot");
    assert.equal(data.decision, "denied");
    assert.equal(data.policyRuleId, "resource.scope");
    assert.equal(data.action.type, "tool");
    assert.equal(data.action.capability, "filesystem.read");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function executeDiscovery(scanPath: string, scopePath = scanPath): Promise<{
  result: Awaited<ReturnType<ToolBroker["execute"]>>;
  events: EventLog;
}> {
  const fileDiscoveryAgent = agents.find((agent) => agent.id === "file-discovery-agent");

  if (!fileDiscoveryAgent) {
    throw new Error("Expected file-discovery-agent to be configured.");
  }

  const events = new EventLog();
  const registry = createToolRegistry();
  const policy = new PolicyEngine({
    businessOverrides: [
      {
        businessId: "business-1",
        agentId: "file-discovery-agent",
        resourceScopes: [
          {
            type: "filesystem.path",
            path: scopePath,
            access: "read",
            businessId: "business-1",
            sourceRootId: "source-root-1"
          }
        ]
      }
    ]
  });
  const broker = new ToolBroker(policy, registry, events);

  const result = await broker.execute(
    fileDiscoveryAgent,
    "discovery.scanRoot",
    {
      path: scanPath,
      businessId: "business-1",
      sourceId: "source-1",
      sourceRootId: "source-root-1",
      discoveryJobId: "discovery-job-1",
      requestedByAgentId: "file-discovery-agent"
    },
    {
      businessId: "business-1",
      sourceId: "source-1",
      sourceRootId: "source-root-1",
      taskId: "task-1",
      sessionId: "session-1"
    }
  );

  return { result, events };
}

function assertDocumentProvenance(document: BusinessDocument): void {
  assert.equal(document.businessId, "business-1");
  assert.equal(document.sourceId, "source-1");
  assert.equal(document.sourceRootId, "source-root-1");
  assert.equal(document.discoveryStatus, "discovered");
  assert.equal(document.approvalStatus, "pending");
  assert.equal(document.provenance.length, 1);
  assert.equal(document.provenance[0].businessId, document.businessId);
  assert.equal(document.provenance[0].sourceId, document.sourceId);
  assert.equal(document.provenance[0].sourceRootId, document.sourceRootId);
  assert.equal(document.provenance[0].subjectType, "document");
  assert.equal(document.provenance[0].subjectId, document.documentId);
  assert.equal(document.provenance[0].discoveryJobId, "discovery-job-1");
  assert.equal(document.provenance[0].capturedByAgentId, "file-discovery-agent");
}
