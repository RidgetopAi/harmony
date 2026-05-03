export type BusinessStatus = "active" | "paused" | "archived";

export type SourceKind =
  | "local_filesystem"
  | "google_drive"
  | "email"
  | "quickbooks"
  | "slack"
  | "teams"
  | "crm"
  | "custom_api";

export type SourceStatus = "configured" | "discovered" | "approved" | "paused" | "revoked";

export type ConnectorStatus =
  | "configured"
  | "connected"
  | "failed"
  | "paused"
  | "revoked"
  | "deleted";

export type SourceAccessStatus = "pending" | "approved" | "denied" | "revoked";
export type SourceAccessMode = "read" | "write" | "read_write";
export type DiscoveryJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type DiscoveryStatus = "discovered" | "queued" | "indexed" | "skipped" | "failed";
export type ApprovalStatus = "pending" | "approved" | "denied" | "deferred" | "expired";

export type Business = {
  businessId: string;
  name: string;
  status: BusinessStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type BusinessAgentAssignment = {
  businessId: string;
  agentId: string;
  role: string;
  assignedAt: Date;
};

export type Source = {
  sourceId: string;
  businessId: string;
  kind: SourceKind;
  displayName: string;
  status: SourceStatus;
  connectorId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Connector = {
  connectorId: string;
  businessId: string;
  sourceId: string;
  provider: SourceKind;
  status: ConnectorStatus;
  configuredAt: Date;
  lastCheckedAt?: Date;
  revokedAt?: Date;
};

export type SourceRoot = {
  sourceRootId: string;
  businessId: string;
  sourceId: string;
  rootPath: string;
  accessMode: SourceAccessMode;
  status: SourceAccessStatus;
  approvedByActorId?: string;
  approvedAt?: Date;
};

export type SourceScope = {
  sourceScopeId: string;
  businessId: string;
  sourceId: string;
  scopeType: "folder" | "label" | "mailbox" | "channel" | "api_scope" | "account";
  externalRef: string;
  accessMode: SourceAccessMode;
  status: SourceAccessStatus;
  approvedByActorId?: string;
  approvedAt?: Date;
};

export type SourceRootReference = {
  businessId: string;
  sourceId: string;
  sourceRootId: string;
  sourceScopeId?: never;
};

export type SourceScopeReference = {
  businessId: string;
  sourceId: string;
  sourceScopeId: string;
  sourceRootId?: never;
};

export type ScopedSourceReference = SourceRootReference | SourceScopeReference;

export type DiscoveryJob = ScopedSourceReference & {
  discoveryJobId: string;
  requestedByAgentId?: string;
  status: DiscoveryJobStatus;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
};

export type ProvenanceSubjectType =
  | "document"
  | "communication"
  | "chunk"
  | "fact"
  | "summary"
  | "answer";

export type ProvenanceRecord = ScopedSourceReference & {
  provenanceId: string;
  subjectType: ProvenanceSubjectType;
  subjectId: string;
  observedAt: Date;
  capturedByAgentId?: string;
  discoveryJobId?: string;
  eventId?: string;
  location?: string;
};

export type Approval = ScopedSourceReference & {
  approvalId: string;
  status: ApprovalStatus;
  targetType: "source" | "sourceRoot" | "sourceScope" | "document" | "communication" | "discoveryJob";
  targetId: string;
  requestedByAgentId?: string;
  resolvedByActorId?: string;
  requestedAt: Date;
  resolvedAt?: Date;
  reason?: string;
};

export type AuditEventReference = {
  eventId: string;
  businessId?: string;
  sourceId?: string;
  sourceRootId?: string;
  sourceScopeId?: string;
};

export type NonEmptyArray<Value> = readonly [Value, ...Value[]];

export type BusinessDocumentInput = ScopedSourceReference & {
  documentId: string;
  path?: string;
  externalRef?: string;
  name: string;
  mimeType?: string;
  extension?: string;
  sizeBytes?: number;
  discoveredAt: Date;
  discoveryStatus: DiscoveryStatus;
  approvalStatus: ApprovalStatus;
  provenance: NonEmptyArray<ProvenanceRecord>;
};

export type BusinessDocument = BusinessDocumentInput;

export type CommunicationInput = ScopedSourceReference & {
  communicationId: string;
  channel: "email" | "chat" | "sms" | "call_transcript" | "comment" | "other";
  externalRef: string;
  subject?: string;
  from?: string;
  to?: readonly string[];
  sentAt?: Date;
  discoveredAt: Date;
  discoveryStatus: DiscoveryStatus;
  approvalStatus: ApprovalStatus;
  provenance: NonEmptyArray<ProvenanceRecord>;
};

export type Communication = CommunicationInput;

export function sourceAccessFor(
  source: Source,
  sourceRoots: readonly SourceRoot[],
  sourceScopes: readonly SourceScope[]
): ScopedSourceReference[] {
  const rootReferences = sourceRoots
    .filter(
      (sourceRoot) =>
        sourceRoot.businessId === source.businessId &&
        sourceRoot.sourceId === source.sourceId &&
        sourceRoot.status === "approved"
    )
    .map<SourceRootReference>((sourceRoot) => ({
      businessId: sourceRoot.businessId,
      sourceId: sourceRoot.sourceId,
      sourceRootId: sourceRoot.sourceRootId
    }));

  const scopeReferences = sourceScopes
    .filter(
      (sourceScope) =>
        sourceScope.businessId === source.businessId &&
        sourceScope.sourceId === source.sourceId &&
        sourceScope.status === "approved"
    )
    .map<SourceScopeReference>((sourceScope) => ({
      businessId: sourceScope.businessId,
      sourceId: sourceScope.sourceId,
      sourceScopeId: sourceScope.sourceScopeId
    }));

  return [...rootReferences, ...scopeReferences];
}

export function sourcesForBusiness(business: Business, sources: readonly Source[]): Source[] {
  return sources.filter((source) => source.businessId === business.businessId);
}

export function defineDocument(input: BusinessDocumentInput): BusinessDocument {
  assertProvenanceMatchesScopedSource(input, input.provenance);
  return input;
}

export function defineCommunication(input: CommunicationInput): Communication {
  assertProvenanceMatchesScopedSource(input, input.provenance);
  return input;
}

function assertProvenanceMatchesScopedSource(
  subject: ScopedSourceReference,
  provenance: readonly ProvenanceRecord[]
): void {
  assertExactlyOneScope(subject, "Business data subject");

  if (provenance.length === 0) {
    throw new Error("Business data requires at least one ProvenanceRecord.");
  }

  for (const record of provenance) {
    assertExactlyOneScope(record, "ProvenanceRecord");

    if (record.businessId !== subject.businessId || record.sourceId !== subject.sourceId) {
      throw new Error("ProvenanceRecord businessId/sourceId must match the business data subject.");
    }

    if ("sourceRootId" in subject && record.sourceRootId !== subject.sourceRootId) {
      throw new Error("ProvenanceRecord sourceRootId must match the business data subject.");
    }

    if ("sourceScopeId" in subject && record.sourceScopeId !== subject.sourceScopeId) {
      throw new Error("ProvenanceRecord sourceScopeId must match the business data subject.");
    }
  }
}

function assertExactlyOneScope(
  reference: Partial<Pick<ScopedSourceReference, "sourceRootId" | "sourceScopeId">>,
  label: string
): void {
  const scopeCount = [reference.sourceRootId, reference.sourceScopeId].filter(Boolean).length;

  if (scopeCount !== 1) {
    throw new Error(`${label} must include exactly one of sourceRootId or sourceScopeId.`);
  }
}
