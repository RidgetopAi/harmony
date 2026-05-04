import type { ApprovalStatus, BusinessDocument, DiscoveryJob } from "../domain/business-source-model.js";
import type {
  DiscoveryDuplicateGroup,
  DiscoveryEntryError,
  DiscoveryFileClassification,
  DiscoveryFileRecord,
  DiscoveryFolderRollup,
  DiscoveryScanRootOutput
} from "./file-discovery.js";

export type DiscoveryRepositoryQuery = {
  businessId?: string;
  sourceId?: string;
  sourceRootId?: string;
  discoveryJobId?: string;
  documentId?: string;
  approvalStatus?: ApprovalStatus;
  classification?: DiscoveryFileClassification;
  folderPath?: string;
};

export type DiscoveryScanRecord = {
  discoveryJob: DiscoveryJob;
  output: DiscoveryScanRootOutput;
};

export interface DiscoveryRepository {
  recordScan(scan: DiscoveryScanRecord): void;
  getScan(discoveryJobId: string): DiscoveryScanRecord | undefined;
  listScans(query?: DiscoveryRepositoryQuery): DiscoveryScanRecord[];
  listDiscoveryJobs(query?: DiscoveryRepositoryQuery): DiscoveryJob[];
  listDocuments(query?: DiscoveryRepositoryQuery): BusinessDocument[];
  listFileRecords(query?: DiscoveryRepositoryQuery): DiscoveryFileRecord[];
  listDuplicateGroups(query?: DiscoveryRepositoryQuery): DiscoveryDuplicateGroup[];
  listFolderRollups(query?: DiscoveryRepositoryQuery): DiscoveryFolderRollup[];
  listErrors(query?: DiscoveryRepositoryQuery): DiscoveryEntryError[];
}

export class InMemoryDiscoveryRepository implements DiscoveryRepository {
  private readonly scansByJobId = new Map<string, DiscoveryScanRecord>();

  recordScan(scan: DiscoveryScanRecord): void {
    this.scansByJobId.set(scan.discoveryJob.discoveryJobId, cloneScan(scan));
  }

  getScan(discoveryJobId: string): DiscoveryScanRecord | undefined {
    const scan = this.scansByJobId.get(discoveryJobId);
    return scan ? cloneScan(scan) : undefined;
  }

  listScans(query: DiscoveryRepositoryQuery = {}): DiscoveryScanRecord[] {
    return [...this.scansByJobId.values()]
      .filter((scan) => scanMatchesQuery(scan, query))
      .map((scan) => cloneScan(scan));
  }

  listDiscoveryJobs(query: DiscoveryRepositoryQuery = {}): DiscoveryJob[] {
    return this.listScans(query).map((scan) => clone(scan.discoveryJob));
  }

  listDocuments(query: DiscoveryRepositoryQuery = {}): BusinessDocument[] {
    return matchingItems(this.scansByJobId.values(), query, (scan) => scan.output.documents);
  }

  listFileRecords(query: DiscoveryRepositoryQuery = {}): DiscoveryFileRecord[] {
    return matchingItems(this.scansByJobId.values(), query, (scan) => scan.output.fileRecords);
  }

  listDuplicateGroups(query: DiscoveryRepositoryQuery = {}): DiscoveryDuplicateGroup[] {
    return matchingItems(this.scansByJobId.values(), query, (scan) => scan.output.duplicateGroups);
  }

  listFolderRollups(query: DiscoveryRepositoryQuery = {}): DiscoveryFolderRollup[] {
    return matchingItems(this.scansByJobId.values(), query, (scan) => scan.output.folderRollups);
  }

  listErrors(query: DiscoveryRepositoryQuery = {}): DiscoveryEntryError[] {
    return matchingItems(this.scansByJobId.values(), query, (scan) => scan.output.errors);
  }
}

function matchingItems<Item>(
  scans: Iterable<DiscoveryScanRecord>,
  query: DiscoveryRepositoryQuery,
  selectItems: (scan: DiscoveryScanRecord) => readonly Item[]
): Item[] {
  return [...scans]
    .filter((scan) => scanMatchesQuery(scan, query))
    .flatMap((scan) =>
      selectItems(scan)
        .filter((item) => itemMatchesQuery(item, scan, query))
        .map((item) => clone(item))
    );
}

function scanMatchesQuery(scan: DiscoveryScanRecord, query: DiscoveryRepositoryQuery): boolean {
  return (
    matchesValue(scan.discoveryJob.businessId, query.businessId) &&
    matchesValue(scan.discoveryJob.sourceId, query.sourceId) &&
    matchesValue(scan.discoveryJob.sourceRootId, query.sourceRootId) &&
    matchesValue(scan.discoveryJob.discoveryJobId, query.discoveryJobId)
  );
}

function itemMatchesQuery(
  item: unknown,
  scan: DiscoveryScanRecord,
  query: DiscoveryRepositoryQuery
): boolean {
  if (!isRecord(item)) {
    return true;
  }

  return (
    matchesDocumentId(item, query.documentId) &&
    matchesApprovalStatus(item, scan, query.approvalStatus) &&
    matchesClassification(item, scan, query.classification) &&
    matchesFolderPath(item, scan, query.folderPath)
  );
}

function matchesDocumentId(item: Record<string, unknown>, documentId: string | undefined): boolean {
  if (!documentId) {
    return true;
  }

  if (item.documentId === documentId) {
    return true;
  }

  if (item.canonicalDocumentId === documentId) {
    return true;
  }

  if (Array.isArray(item.files)) {
    return item.files.some((file) => isRecord(file) && file.documentId === documentId);
  }

  return false;
}

function matchesApprovalStatus(
  item: Record<string, unknown>,
  scan: DiscoveryScanRecord,
  approvalStatus: ApprovalStatus | undefined
): boolean {
  if (!approvalStatus) {
    return true;
  }

  if (item.approvalStatus === approvalStatus) {
    return true;
  }

  const documentId = getItemDocumentId(item);
  const document = documentId
    ? scan.output.documents.find((candidate) => candidate.documentId === documentId)
    : undefined;

  return document?.approvalStatus === approvalStatus;
}

function matchesClassification(
  item: Record<string, unknown>,
  scan: DiscoveryScanRecord,
  classification: DiscoveryFileClassification | undefined
): boolean {
  if (!classification) {
    return true;
  }

  if (item.classification === classification) {
    return true;
  }

  if (Array.isArray(item.files)) {
    return item.files.some((file) => isRecord(file) && file.classification === classification);
  }

  const documentId = getItemDocumentId(item);
  const fileRecord = documentId
    ? scan.output.fileRecords.find((record) => record.documentId === documentId)
    : undefined;

  return fileRecord?.classification === classification;
}

function matchesFolderPath(
  item: Record<string, unknown>,
  scan: DiscoveryScanRecord,
  folderPath: string | undefined
): boolean {
  if (folderPath === undefined) {
    return true;
  }

  if (item.path === folderPath && "folderId" in item) {
    return true;
  }

  if (item.parentFolder === folderPath) {
    return true;
  }

  const documentId = getItemDocumentId(item);
  const fileRecord = documentId
    ? scan.output.fileRecords.find((record) => record.documentId === documentId)
    : undefined;

  if (fileRecord?.parentFolder === folderPath) {
    return true;
  }

  if (!Array.isArray(item.files)) {
    return false;
  }

  return item.files.some((file) => {
    if (!isRecord(file) || typeof file.documentId !== "string") {
      return false;
    }

    const groupedFileRecord = scan.output.fileRecords.find(
      (record) => record.documentId === file.documentId
    );

    return groupedFileRecord?.parentFolder === folderPath;
  });
}

function getItemDocumentId(item: Record<string, unknown>): string | undefined {
  if (typeof item.documentId === "string") {
    return item.documentId;
  }

  if (typeof item.canonicalDocumentId === "string") {
    return item.canonicalDocumentId;
  }

  return undefined;
}

function matchesValue(actual: string | undefined, expected: string | undefined): boolean {
  return !expected || actual === expected;
}

function cloneScan(scan: DiscoveryScanRecord): DiscoveryScanRecord {
  return clone(scan);
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
