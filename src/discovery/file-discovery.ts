import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  defineDocument,
  type ApprovalStatus,
  type BusinessDocument,
  type DiscoveryStatus,
  type ProvenanceRecord
} from "../domain/business-source-model.js";
import type { ToolResult } from "../tools/tool-registry.js";

export type DiscoveryScanRootInput = {
  path: string;
  businessId: string;
  sourceId: string;
  sourceRootId: string;
  discoveryJobId?: string;
  requestedByAgentId?: string;
  maxEntries?: number;
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
  rootPath: string;
  scannedAt: Date;
  filesDiscovered: number;
  directoriesVisited: number;
  skippedEntries: number;
  errors: number;
  truncated: boolean;
};

export type DiscoveryScanRootOutput = {
  summary: DiscoveryScanSummary;
  documents: BusinessDocument[];
  errors: DiscoveryEntryError[];
};

type ScanState = {
  input: Required<Pick<DiscoveryScanRootInput, "businessId" | "sourceId" | "sourceRootId">> &
    Pick<DiscoveryScanRootInput, "discoveryJobId" | "requestedByAgentId">;
  rootPath: string;
  scannedAt: Date;
  maxEntries: number;
  documents: BusinessDocument[];
  errors: DiscoveryEntryError[];
  directoriesVisited: number;
  skippedEntries: number;
  truncated: boolean;
};

const DEFAULT_MAX_ENTRIES = 1_000;

export async function discoveryScanRootTool(input: unknown): Promise<ToolResult> {
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
      output: await scanSourceRoot(parsed.input)
    };
  } catch (error) {
    return {
      ok: false,
      output: errorMessage(error)
    };
  }
}

export async function scanSourceRoot(input: DiscoveryScanRootInput): Promise<DiscoveryScanRootOutput> {
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
    documents: [],
    errors: [],
    directoriesVisited: 0,
    skippedEntries: 0,
    truncated: false
  };

  await scanDirectory(rootPath, state);

  return {
    summary: {
      businessId: input.businessId,
      sourceId: input.sourceId,
      sourceRootId: input.sourceRootId,
      rootPath,
      scannedAt: state.scannedAt,
      filesDiscovered: state.documents.length,
      directoriesVisited: state.directoriesVisited,
      skippedEntries: state.skippedEntries,
      errors: state.errors.length,
      truncated: state.truncated
    },
    documents: state.documents,
    errors: state.errors
  };
}

async function scanDirectory(directoryPath: string, state: ScanState): Promise<void> {
  if (state.truncated) {
    return;
  }

  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
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

      state.documents.push(createDocument(entryPath, entryStats.size, state));
    } catch (error) {
      state.errors.push(toDiscoveryError(entryPath, error));
    }
  }
}

function createDocument(filePath: string, sizeBytes: number, state: ScanState): BusinessDocument {
  const relativePath = path.relative(state.rootPath, filePath);
  const documentId = randomUUID();
  const provenance: ProvenanceRecord = {
    provenanceId: randomUUID(),
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

  return defineDocument({
    documentId,
    businessId: state.input.businessId,
    sourceId: state.input.sourceId,
    sourceRootId: state.input.sourceRootId,
    path: filePath,
    externalRef: relativePath,
    name: path.basename(filePath),
    mimeType: mimeTypeFor(filePath),
    extension: path.extname(filePath) || undefined,
    sizeBytes,
    discoveredAt: state.scannedAt,
    discoveryStatus: "discovered" satisfies DiscoveryStatus,
    approvalStatus: "pending" satisfies ApprovalStatus,
    provenance: [provenance]
  });
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

  return {
    ok: true,
    input: {
      path: rootPath,
      businessId,
      sourceId,
      sourceRootId,
      discoveryJobId: candidate.discoveryJobId,
      requestedByAgentId: candidate.requestedByAgentId,
      maxEntries: candidate.maxEntries
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

function mimeTypeFor(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();

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
