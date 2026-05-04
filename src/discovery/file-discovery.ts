import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  defineDocument,
  type ApprovalStatus,
  type BusinessDocument,
  type DiscoveryJob,
  type DiscoveryStatus,
  type ProvenanceRecord
} from "../domain/business-source-model.js";
import type { DiscoveryRepository, DiscoveryScanRecord } from "./discovery-repository.js";
import type { ToolHandler, ToolResult } from "../tools/tool-registry.js";

export type DiscoveryScanRootInput = {
  path: string;
  businessId: string;
  sourceId: string;
  sourceRootId: string;
  discoveryJobId?: string;
  requestedByAgentId?: string;
  maxEntries?: number;
  hashMaxBytes?: number;
};

export type DiscoveryEntryError = {
  path: string;
  code?: string;
  message: string;
};

export type DiscoveryScanSummary = {
  businessId: string;
  sourceId: string;
  sourceRootId: string;
  discoveryJobId?: string;
  requestedByAgentId?: string;
  rootPath: string;
  scannedAt: Date;
  filesDiscovered: number;
  directoriesVisited: number;
  skippedEntries: number;
  errors: number;
  truncated: boolean;
  bytesDiscovered: number;
  duplicateGroups: number;
  duplicateFiles: number;
  classificationBreakdown: Record<DiscoveryFileClassification, number>;
  fileTypeBreakdown: Record<string, number>;
  sourceAreaBreakdown: Record<string, number>;
};

export type DiscoveryFileClassification = "recommended" | "review" | "archive" | "skip" | "duplicate";

export type DiscoveryFileRecord = {
  documentId: string;
  businessId: string;
  sourceId: string;
  sourceRootId: string;
  path: string;
  absolutePath: string;
  parentFolder: string;
  sourceArea: string;
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: Date;
  contentHash: string | null;
  status: "discovered" | "candidate";
  usefulnessScore: number;
  classification: DiscoveryFileClassification;
  classificationReasons: string[];
};

export type DiscoveryDuplicateGroup = {
  contentHash: string;
  duplicateCount: number;
  canonicalDocumentId: string;
  files: Array<{
    documentId: string;
    path: string;
    classification: DiscoveryFileClassification;
    usefulnessScore: number;
  }>;
};

export type DiscoveryFolderRollup = {
  folderId: string;
  businessId: string;
  sourceId: string;
  sourceRootId: string;
  path: string;
  sourceArea: string;
  totalFiles: number;
  recommendedCount: number;
  reviewCount: number;
  archiveCount: number;
  skipCount: number;
  duplicateCount: number;
  totalSizeBytes: number;
  suggestedAction: "include" | "review" | "exclude";
};

export type DiscoveryScanRootOutput = {
  summary: DiscoveryScanSummary;
  documents: BusinessDocument[];
  fileRecords: DiscoveryFileRecord[];
  duplicateGroups: DiscoveryDuplicateGroup[];
  folderRollups: DiscoveryFolderRollup[];
  errors: DiscoveryEntryError[];
};

export type DiscoveryScanOptions = {
  repository?: DiscoveryRepository;
};

type ScanState = {
  input: Required<Pick<DiscoveryScanRootInput, "businessId" | "sourceId" | "sourceRootId">> &
    Pick<DiscoveryScanRootInput, "discoveryJobId" | "requestedByAgentId">;
  rootPath: string;
  scannedAt: Date;
  maxEntries: number;
  hashMaxBytes: number;
  documents: BusinessDocument[];
  fileRecords: DiscoveryFileRecord[];
  errors: DiscoveryEntryError[];
  directoriesVisited: number;
  skippedEntries: number;
  truncated: boolean;
};

const DEFAULT_MAX_ENTRIES = 1_000;
const DEFAULT_HASH_MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md", ".pptx"]);
const NOISY_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "cache",
  "tmp",
  "temp",
  "__pycache__",
  ".next",
  "dist",
  "build"
]);
const USEFUL_KEYWORDS = [
  "policy",
  "procedure",
  "sop",
  "contract",
  "agreement",
  "invoice",
  "handbook",
  "onboarding",
  "price",
  "pricing",
  "proposal",
  "estimate",
  "license",
  "insurance",
  "template",
  "client",
  "customer"
];
const NOISY_KEYWORDS = ["backup", "archive", "old", "tmp", "temp", "downloads", "cache", "copy", "final_final"];
const SENSITIVE_KEYWORDS = ["payroll", "employee", "hr", "onboarding", "insurance"];
const SOURCE_AREA_LABELS: Array<[string, string]> = [
  ["local_computer", "Local Computer"],
  ["google_drive", "Google Drive"],
  ["quickbooks_exports", "QuickBooks Exports"],
  ["email_exports", "Email Exports"],
  ["metadata", "Ground Truth Metadata"]
];

export async function discoveryScanRootTool(input: unknown): Promise<ToolResult> {
  return createDiscoveryScanRootTool()(input);
}

export function createDiscoveryScanRootTool(repository?: DiscoveryRepository): ToolHandler {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = parseDiscoveryScanRootInput(input);

    if (!parsed.ok) {
      return {
        ok: false,
        output: parsed.reason
      };
    }

    try {
      return {
        ok: true,
        output: await scanSourceRoot(parsed.input, { repository })
      };
    } catch (error) {
      return {
        ok: false,
        output: errorMessage(error)
      };
    }
  };
}

export async function scanSourceRoot(
  input: DiscoveryScanRootInput,
  options: DiscoveryScanOptions = {}
): Promise<DiscoveryScanRootOutput> {
  const rootPath = path.resolve(input.path);
  const state: ScanState = {
    input: {
      businessId: input.businessId,
      sourceId: input.sourceId,
      sourceRootId: input.sourceRootId,
      discoveryJobId: input.discoveryJobId,
      requestedByAgentId: input.requestedByAgentId
    },
    rootPath,
    scannedAt: new Date(),
    maxEntries: input.maxEntries ?? DEFAULT_MAX_ENTRIES,
    hashMaxBytes: input.hashMaxBytes ?? DEFAULT_HASH_MAX_BYTES,
    documents: [],
    fileRecords: [],
    errors: [],
    directoriesVisited: 0,
    skippedEntries: 0,
    truncated: false
  };

  await scanDirectory(rootPath, state);
  const duplicateGroups = createDuplicateGroups(state.fileRecords);
  applyDuplicateClassification(state.fileRecords, duplicateGroups);
  const folderRollups = createFolderRollups(state.fileRecords, duplicateGroups, state.input);
  const classificationBreakdown = countByClassification(state.fileRecords);
  const fileTypeBreakdown = countByExtension(state.fileRecords);
  const sourceAreaBreakdown = countBySourceArea(state.fileRecords);

  const output = {
    summary: {
      businessId: input.businessId,
      sourceId: input.sourceId,
      sourceRootId: input.sourceRootId,
      discoveryJobId: input.discoveryJobId,
      requestedByAgentId: input.requestedByAgentId,
      rootPath,
      scannedAt: state.scannedAt,
      filesDiscovered: state.documents.length,
      directoriesVisited: state.directoriesVisited,
      skippedEntries: state.skippedEntries,
      errors: state.errors.length,
      truncated: state.truncated,
      bytesDiscovered: state.fileRecords.reduce((sum, record) => sum + record.sizeBytes, 0),
      duplicateGroups: duplicateGroups.length,
      duplicateFiles: duplicateGroups.reduce((sum, group) => sum + group.duplicateCount, 0),
      classificationBreakdown,
      fileTypeBreakdown,
      sourceAreaBreakdown
    },
    documents: state.documents,
    fileRecords: state.fileRecords,
    duplicateGroups,
    folderRollups,
    errors: state.errors
  };

  if (options.repository && input.discoveryJobId) {
    options.repository.recordScan(createDiscoveryScanRecord(input, output));
  }

  return output;
}

export function createDiscoveryScanRecord(
  input: DiscoveryScanRootInput,
  output: DiscoveryScanRootOutput
): DiscoveryScanRecord {
  if (!input.discoveryJobId) {
    throw new Error("Discovery repository recording requires discoveryJobId.");
  }

  const discoveryJob: DiscoveryJob = {
    discoveryJobId: input.discoveryJobId,
    businessId: input.businessId,
    sourceId: input.sourceId,
    sourceRootId: input.sourceRootId,
    requestedByAgentId: input.requestedByAgentId,
    status: "completed",
    startedAt: output.summary.scannedAt,
    completedAt: output.summary.scannedAt
  };

  return {
    discoveryJob,
    output
  };
}

async function scanDirectory(directoryPath: string, state: ScanState): Promise<void> {
  if (state.truncated) {
    return;
  }

  let entries;

  try {
    entries = (await readdir(directoryPath, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    state.directoriesVisited += 1;
  } catch (error) {
    state.errors.push(toDiscoveryError(directoryPath, error));
    return;
  }

  for (const entry of entries) {
    if (state.documents.length >= state.maxEntries) {
      state.truncated = true;
      return;
    }

    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (NOISY_DIRECTORIES.has(entry.name.toLowerCase())) {
        state.skippedEntries += 1;
        continue;
      }

      await scanDirectory(entryPath, state);
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      state.skippedEntries += 1;
      continue;
    }

    try {
      const entryStats = await stat(entryPath);

      if (entryStats.isDirectory()) {
        await scanDirectory(entryPath, state);
        continue;
      }

      if (!entryStats.isFile()) {
        state.skippedEntries += 1;
        continue;
      }

      const scannedFile = await createScannedFile(entryPath, entryStats.size, entryStats.mtime, state);
      state.documents.push(scannedFile.document);
      state.fileRecords.push(scannedFile.fileRecord);
    } catch (error) {
      state.errors.push(toDiscoveryError(entryPath, error));
    }
  }
}

async function createScannedFile(
  filePath: string,
  sizeBytes: number,
  modifiedAt: Date,
  state: ScanState
): Promise<{ document: BusinessDocument; fileRecord: DiscoveryFileRecord }> {
  const relativePath = normalizeRelativePath(path.relative(state.rootPath, filePath));
  const name = path.basename(filePath);
  const extension = extensionFor(name);
  const hashComputed = sizeBytes <= state.hashMaxBytes;
  const contentHash = hashComputed ? await sha256(filePath) : null;
  const scored = scoreFile(relativePath, name, extension, sizeBytes, hashComputed);
  const documentId = stableId("document", `${state.input.sourceRootId}:${relativePath}`);
  const provenance: ProvenanceRecord = {
    provenanceId: stableId("provenance", documentId),
    subjectType: "document",
    subjectId: documentId,
    businessId: state.input.businessId,
    sourceId: state.input.sourceId,
    sourceRootId: state.input.sourceRootId,
    observedAt: state.scannedAt,
    capturedByAgentId: state.input.requestedByAgentId,
    discoveryJobId: state.input.discoveryJobId,
    location: relativePath
  };

  const document = defineDocument({
    documentId,
    businessId: state.input.businessId,
    sourceId: state.input.sourceId,
    sourceRootId: state.input.sourceRootId,
    path: filePath,
    externalRef: relativePath,
    name,
    mimeType: mimeTypeFor(filePath),
    extension: extension || undefined,
    sizeBytes,
    discoveredAt: state.scannedAt,
    discoveryStatus: "discovered" satisfies DiscoveryStatus,
    approvalStatus: "pending" satisfies ApprovalStatus,
    provenance: [provenance]
  });

  return {
    document,
    fileRecord: {
      documentId,
      businessId: state.input.businessId,
      sourceId: state.input.sourceId,
      sourceRootId: state.input.sourceRootId,
      path: relativePath,
      absolutePath: filePath,
      parentFolder: parentFolder(relativePath),
      sourceArea: sourceArea(relativePath),
      name,
      extension,
      sizeBytes,
      modifiedAt,
      contentHash,
      status: "discovered",
      usefulnessScore: scored.score,
      classification: scored.classification,
      classificationReasons: scored.reasons
    }
  };
}

function parseDiscoveryScanRootInput(
  input: unknown
): { ok: true; input: DiscoveryScanRootInput } | { ok: false; reason: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "discovery.scanRoot input must be an object." };
  }

  const candidate = input as Partial<DiscoveryScanRootInput>;

  const rootPath = candidate.path;
  const businessId = candidate.businessId;
  const sourceId = candidate.sourceId;
  const sourceRootId = candidate.sourceRootId;

  if (typeof rootPath !== "string" || rootPath.length === 0) {
    return { ok: false, reason: "discovery.scanRoot input requires path." };
  }

  if (typeof businessId !== "string" || businessId.length === 0) {
    return { ok: false, reason: "discovery.scanRoot input requires businessId." };
  }

  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return { ok: false, reason: "discovery.scanRoot input requires sourceId." };
  }

  if (typeof sourceRootId !== "string" || sourceRootId.length === 0) {
    return { ok: false, reason: "discovery.scanRoot input requires sourceRootId." };
  }

  if (
    candidate.maxEntries !== undefined &&
    (!Number.isInteger(candidate.maxEntries) || candidate.maxEntries < 1)
  ) {
    return { ok: false, reason: "discovery.scanRoot maxEntries must be a positive integer." };
  }

  if (
    candidate.hashMaxBytes !== undefined &&
    (!Number.isInteger(candidate.hashMaxBytes) || candidate.hashMaxBytes < 0)
  ) {
    return { ok: false, reason: "discovery.scanRoot hashMaxBytes must be a non-negative integer." };
  }

  return {
    ok: true,
    input: {
      path: rootPath,
      businessId,
      sourceId,
      sourceRootId,
      discoveryJobId: candidate.discoveryJobId,
      requestedByAgentId: candidate.requestedByAgentId,
      maxEntries: candidate.maxEntries,
      hashMaxBytes: candidate.hashMaxBytes
    }
  };
}

function toDiscoveryError(filePath: string, error: unknown): DiscoveryEntryError {
  return {
    path: filePath,
    code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined,
    message: errorMessage(error)
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableId(prefix: string, text: string): string {
  return `${prefix}_${createHash("sha1").update(text).digest("hex").slice(0, 16)}`;
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function extensionFor(filename: string): string {
  if (filename.endsWith(".ocr.txt")) {
    return ".ocr.txt";
  }

  if (filename.endsWith(".jpg.txt")) {
    return ".jpg.txt";
  }

  return path.extname(filename).toLowerCase() || "";
}

function scoreFile(
  relativePath: string,
  filename: string,
  extension: string,
  sizeBytes: number,
  hashComputed: boolean
): { score: number; classification: DiscoveryFileClassification; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];
  const text = `${relativePath} ${filename}`.toLowerCase();

  if (SUPPORTED_EXTENSIONS.has(extension)) {
    score += 10;
    reasons.push("supported_extension");
  } else {
    score -= 30;
    reasons.push("unsupported_extension");
  }

  if (hasKeyword(text, USEFUL_KEYWORDS)) {
    score += 20;
    reasons.push("useful_keyword");
  }

  if (hashComputed) {
    score += 5;
    reasons.push("hash_computed");
  }

  if (hasKeyword(text, NOISY_KEYWORDS)) {
    score -= 25;
    reasons.push("noisy_path_keyword");
  }

  if (sizeBytes === 0) {
    score -= 50;
    reasons.push("zero_byte_file");
  }

  score = Math.max(0, Math.min(100, score));

  const classification: DiscoveryFileClassification =
    score >= 80 ? "recommended" : score >= 50 ? "review" : score >= 20 ? "archive" : "skip";

  if (hasKeyword(text, SENSITIVE_KEYWORDS) && classification !== "skip") {
    reasons.push("sensitive_review_keyword");
  }

  return { score, classification, reasons };
}

function hasKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function createDuplicateGroups(fileRecords: readonly DiscoveryFileRecord[]): DiscoveryDuplicateGroup[] {
  const byHash = new Map<string, DiscoveryFileRecord[]>();

  for (const record of fileRecords) {
    if (!record.contentHash) {
      continue;
    }

    const records = byHash.get(record.contentHash) ?? [];
    records.push(record);
    byHash.set(record.contentHash, records);
  }

  return [...byHash.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([contentHash, records]) => {
      const canonical = [...records].sort(
        (a, b) => b.usefulnessScore - a.usefulnessScore || a.path.localeCompare(b.path)
      )[0];

      return {
        contentHash,
        duplicateCount: records.length,
        canonicalDocumentId: canonical.documentId,
        files: records.map((record) => ({
          documentId: record.documentId,
          path: record.path,
          classification: record.classification,
          usefulnessScore: record.usefulnessScore
        }))
      };
    })
    .sort((a, b) => b.duplicateCount - a.duplicateCount || a.contentHash.localeCompare(b.contentHash));
}

function applyDuplicateClassification(
  fileRecords: DiscoveryFileRecord[],
  duplicateGroups: readonly DiscoveryDuplicateGroup[]
): void {
  const duplicateDocumentIds = new Set<string>();

  for (const group of duplicateGroups) {
    for (const file of group.files) {
      if (file.documentId !== group.canonicalDocumentId) {
        duplicateDocumentIds.add(file.documentId);
      }
    }
  }

  for (const record of fileRecords) {
    if (!duplicateDocumentIds.has(record.documentId)) {
      continue;
    }

    record.classification = "duplicate";
    record.status = "candidate";
    record.classificationReasons.push("duplicate_content_hash");
  }
}

function createFolderRollups(
  fileRecords: readonly DiscoveryFileRecord[],
  duplicateGroups: readonly DiscoveryDuplicateGroup[],
  input: Required<Pick<DiscoveryScanRootInput, "businessId" | "sourceId" | "sourceRootId">>
): DiscoveryFolderRollup[] {
  const folders = new Map<string, DiscoveryFolderRollup>();
  const duplicateCountsByFolder = duplicateCountsForFolders(fileRecords, duplicateGroups);

  for (const record of fileRecords) {
    const existing = folders.get(record.parentFolder);
    const folder =
      existing ??
      {
        folderId: stableId("folder", `${input.sourceRootId}:${record.parentFolder || "."}`),
        businessId: input.businessId,
        sourceId: input.sourceId,
        sourceRootId: input.sourceRootId,
        path: record.parentFolder,
        sourceArea: sourceArea(record.parentFolder),
        totalFiles: 0,
        recommendedCount: 0,
        reviewCount: 0,
        archiveCount: 0,
        skipCount: 0,
        duplicateCount: 0,
        totalSizeBytes: 0,
        suggestedAction: "review" as const
      };

    folder.totalFiles += 1;
    folder.totalSizeBytes += record.sizeBytes;

    if (record.classification === "recommended") {
      folder.recommendedCount += 1;
    } else if (record.classification === "review") {
      folder.reviewCount += 1;
    } else if (record.classification === "archive" || record.classification === "duplicate") {
      folder.archiveCount += 1;
    } else {
      folder.skipCount += 1;
    }

    folders.set(record.parentFolder, folder);
  }

  for (const folder of folders.values()) {
    folder.duplicateCount = duplicateCountsByFolder.get(folder.path) ?? 0;
    const recommendedRatio = folder.recommendedCount / folder.totalFiles;
    const skipRatio = folder.skipCount / folder.totalFiles;

    if (recommendedRatio > 0.6) {
      folder.suggestedAction = "include";
    } else if (skipRatio > 0.6) {
      folder.suggestedAction = "exclude";
    } else {
      folder.suggestedAction = "review";
    }
  }

  return [...folders.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function duplicateCountsForFolders(
  fileRecords: readonly DiscoveryFileRecord[],
  duplicateGroups: readonly DiscoveryDuplicateGroup[]
): Map<string, number> {
  const recordsById = new Map(fileRecords.map((record) => [record.documentId, record]));
  const counts = new Map<string, number>();

  for (const group of duplicateGroups) {
    for (const file of group.files) {
      const record = recordsById.get(file.documentId);

      if (!record) {
        continue;
      }

      counts.set(record.parentFolder, (counts.get(record.parentFolder) ?? 0) + 1);
    }
  }

  return counts;
}

function countByClassification(
  fileRecords: readonly DiscoveryFileRecord[]
): Record<DiscoveryFileClassification, number> {
  const counts: Record<DiscoveryFileClassification, number> = {
    recommended: 0,
    review: 0,
    archive: 0,
    skip: 0,
    duplicate: 0
  };

  for (const record of fileRecords) {
    counts[record.classification] += 1;
  }

  return counts;
}

function countByExtension(fileRecords: readonly DiscoveryFileRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const record of fileRecords) {
    const extension = record.extension || "[none]";
    counts[extension] = (counts[extension] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function countBySourceArea(fileRecords: readonly DiscoveryFileRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const record of fileRecords) {
    counts[record.sourceArea] = (counts[record.sourceArea] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll(path.sep, "/");
}

function parentFolder(relativePath: string): string {
  const folder = normalizeRelativePath(path.dirname(relativePath));
  return folder === "." ? "" : folder;
}

function sourceArea(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const match = SOURCE_AREA_LABELS.find(
    ([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );

  return match?.[1] ?? "Other";
}

function mimeTypeFor(filePath: string): string | undefined {
  const extension = extensionFor(path.basename(filePath));

  switch (extension) {
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".json":
      return "application/json";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    default:
      return undefined;
  }
}
