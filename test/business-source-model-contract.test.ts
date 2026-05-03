import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defineCommunication,
  defineDocument,
  sourceAccessFor,
  sourcesForBusiness,
  type Business,
  type BusinessDocumentInput,
  type CommunicationInput,
  type ProvenanceRecord,
  type Source,
  type SourceRoot,
  type SourceScope
} from "../src/domain/business-source-model.js";

const now = new Date("2026-05-03T12:00:00.000Z");

test("businesses can own multiple configured sources without mixing other businesses", () => {
  const business: Business = {
    businessId: "business-1",
    name: "Ridge Coffee",
    status: "active",
    createdAt: now,
    updatedAt: now
  };

  const sources: Source[] = [
    {
      businessId: "business-1",
      sourceId: "source-files",
      kind: "local_filesystem",
      displayName: "Shared files",
      status: "configured",
      createdAt: now,
      updatedAt: now
    },
    {
      businessId: "business-1",
      sourceId: "source-mail",
      kind: "email",
      displayName: "Operations mailbox",
      status: "configured",
      connectorId: "connector-mail",
      createdAt: now,
      updatedAt: now
    },
    {
      businessId: "business-2",
      sourceId: "source-other",
      kind: "slack",
      displayName: "Other business Slack",
      status: "configured",
      createdAt: now,
      updatedAt: now
    }
  ];

  assert.deepEqual(
    sourcesForBusiness(business, sources).map((source) => source.sourceId),
    ["source-files", "source-mail"]
  );
});

test("source access is explicit and limited to approved roots or scopes", () => {
  const source: Source = {
    businessId: "business-1",
    sourceId: "source-1",
    kind: "local_filesystem",
    displayName: "Shared drive",
    status: "configured",
    createdAt: now,
    updatedAt: now
  };

  const roots: SourceRoot[] = [
    {
      businessId: "business-1",
      sourceId: "source-1",
      sourceRootId: "source-root-approved",
      rootPath: "/business/shared",
      accessMode: "read",
      status: "approved",
      approvedByActorId: "owner-1",
      approvedAt: now
    },
    {
      businessId: "business-1",
      sourceId: "source-1",
      sourceRootId: "source-root-pending",
      rootPath: "/business/private",
      accessMode: "read",
      status: "pending"
    }
  ];

  const scopes: SourceScope[] = [
    {
      businessId: "business-1",
      sourceId: "source-1",
      sourceScopeId: "source-scope-approved",
      scopeType: "label",
      externalRef: "inbox/support",
      accessMode: "read",
      status: "approved",
      approvedByActorId: "owner-1",
      approvedAt: now
    },
    {
      businessId: "business-2",
      sourceId: "source-1",
      sourceScopeId: "source-scope-other-business",
      scopeType: "channel",
      externalRef: "ops",
      accessMode: "read",
      status: "approved"
    }
  ];

  assert.deepEqual(sourceAccessFor(source, [], []), []);
  assert.deepEqual(sourceAccessFor(source, roots, scopes), [
    {
      businessId: "business-1",
      sourceId: "source-1",
      sourceRootId: "source-root-approved"
    },
    {
      businessId: "business-1",
      sourceId: "source-1",
      sourceScopeId: "source-scope-approved"
    }
  ]);
});

test("documents require business source identity and matching provenance", () => {
  const provenance: ProvenanceRecord = {
    provenanceId: "provenance-1",
    subjectType: "document",
    subjectId: "document-1",
    businessId: "business-1",
    sourceId: "source-1",
    sourceRootId: "source-root-1",
    observedAt: now,
    discoveryJobId: "discovery-job-1",
    eventId: "event-1",
    location: "/business/shared/invoice.pdf"
  };

  const document = defineDocument({
    documentId: "document-1",
    businessId: "business-1",
    sourceId: "source-1",
    sourceRootId: "source-root-1",
    path: "/business/shared/invoice.pdf",
    name: "invoice.pdf",
    mimeType: "application/pdf",
    extension: ".pdf",
    sizeBytes: 128,
    discoveredAt: now,
    discoveryStatus: "discovered",
    approvalStatus: "pending",
    provenance: [provenance]
  });

  assert.equal(document.businessId, "business-1");
  assert.equal(document.sourceId, "source-1");
  assert.equal(document.provenance[0].sourceRootId, "source-root-1");

  assert.throws(
    () =>
      defineDocument({
        ...document,
        provenance: []
      } as unknown as BusinessDocumentInput),
    /at least one ProvenanceRecord/
  );

  assert.throws(
    () =>
      defineDocument({
        ...document,
        sourceScopeId: "source-scope-invalid"
      } as unknown as BusinessDocumentInput),
    /exactly one of sourceRootId or sourceScopeId/
  );

  assert.throws(
    () =>
      defineDocument({
        ...document,
        provenance: [
          {
            ...provenance,
            sourceRootId: "source-root-other"
          }
        ]
      }),
    /sourceRootId must match/
  );
});

test("communications require scoped source provenance", () => {
  const communicationInput: CommunicationInput = {
    communicationId: "communication-1",
    businessId: "business-1",
    sourceId: "source-mail",
    sourceScopeId: "source-scope-inbox",
    channel: "email",
    externalRef: "message-1",
    subject: "Delivery schedule",
    from: "ops@example.com",
    to: ["owner@example.com"],
    sentAt: now,
    discoveredAt: now,
    discoveryStatus: "discovered",
    approvalStatus: "pending",
    provenance: [
      {
        provenanceId: "provenance-communication-1",
        subjectType: "communication",
        subjectId: "communication-1",
        businessId: "business-1",
        sourceId: "source-mail",
        sourceScopeId: "source-scope-inbox",
        observedAt: now,
        eventId: "event-communication-1",
        location: "message-1"
      }
    ]
  };

  const communication = defineCommunication(communicationInput);

  assert.equal(communication.sourceScopeId, "source-scope-inbox");
  assert.equal(communication.provenance[0].businessId, communication.businessId);
  assert.throws(
    () =>
      defineCommunication({
        ...communicationInput,
        provenance: [
          {
            ...communicationInput.provenance[0],
            sourceId: "source-other"
          }
        ]
      }),
    /businessId\/sourceId must match/
  );
});
