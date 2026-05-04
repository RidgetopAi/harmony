import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { InMemoryDiscoveryRepository } from "../src/discovery/discovery-repository.js";
import { scanSourceRoot } from "../src/discovery/file-discovery.js";

test("in-memory discovery repository stores scans and queries discovered approval targets", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-discovery-repository-"));

  try {
    await mkdir(path.join(directory, "ops"));
    writeFileSync(path.join(directory, "invoice.txt"), "invoice");
    writeFileSync(path.join(directory, "ops", "policy.md"), "# Policy");
    writeFileSync(path.join(directory, "ops", "invoice copy.txt"), "invoice");

    const repository = new InMemoryDiscoveryRepository();
    const output = await scanSourceRoot(
      {
        path: directory,
        businessId: "business-1",
        sourceId: "source-1",
        sourceRootId: "source-root-1",
        discoveryJobId: "discovery-job-1",
        requestedByAgentId: "file-discovery-agent"
      },
      { repository }
    );
    const invoiceCopy = output.fileRecords.find((record) => record.name === "invoice copy.txt");

    assert.ok(invoiceCopy);
    assert.equal(repository.getScan("discovery-job-1")?.output.documents.length, 3);
    assert.equal(repository.listDiscoveryJobs({ businessId: "business-1" }).length, 1);
    assert.equal(repository.listDiscoveryJobs({ sourceId: "source-1" }).length, 1);
    assert.equal(repository.listDiscoveryJobs({ sourceRootId: "source-root-1" }).length, 1);
    assert.equal(repository.listDocuments({ discoveryJobId: "discovery-job-1" }).length, 3);
    assert.equal(repository.listDocuments({ approvalStatus: "pending" }).length, 3);
    assert.equal(repository.listDocuments({ classification: "duplicate" }).length, 1);
    assert.equal(repository.listFileRecords({ classification: "recommended" }).length, 2);
    assert.equal(repository.listFileRecords({ folderPath: "ops" }).length, 2);
    assert.equal(repository.listFolderRollups({ folderPath: "ops" }).length, 1);
    assert.equal(repository.listDuplicateGroups({ documentId: invoiceCopy.documentId }).length, 1);
    assert.equal(repository.listErrors({ businessId: "business-1" }).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("in-memory discovery repository replaces repeated job scans and returns defensive copies", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-discovery-repository-replace-"));

  try {
    writeFileSync(path.join(directory, "invoice.txt"), "invoice");

    const repository = new InMemoryDiscoveryRepository();
    await scanSourceRoot(
      {
        path: directory,
        businessId: "business-1",
        sourceId: "source-1",
        sourceRootId: "source-root-1",
        discoveryJobId: "discovery-job-1"
      },
      { repository }
    );

    const firstDocument = repository.listDocuments({ discoveryJobId: "discovery-job-1" })[0];
    firstDocument.name = "mutated.txt";

    assert.equal(repository.listDocuments({ documentId: firstDocument.documentId })[0].name, "invoice.txt");

    writeFileSync(path.join(directory, "policy.md"), "# Policy");

    const secondOutput = await scanSourceRoot(
      {
        path: directory,
        businessId: "business-1",
        sourceId: "source-1",
        sourceRootId: "source-root-1",
        discoveryJobId: "discovery-job-1"
      },
      { repository }
    );

    assert.equal(repository.listScans().length, 1);
    assert.equal(
      repository.listDocuments({ discoveryJobId: "discovery-job-1" }).length,
      secondOutput.documents.length
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
