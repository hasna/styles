import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prettyJson, truncateText } from "../../lib/format.js";
import {
  type ArtifactSyncResult,
  type SyncResult,
  getStorageS3Status,
  getStorageStatus,
  storageArtifactsDownload,
  storageArtifactsUpload,
  storagePull,
  storagePush,
  storageSync,
} from "../../lib/storage-sync.js";

export function registerStorageTools(server: McpServer): void {
  server.tool(
    "storage_status",
    "Show open-styles local and remote storage configuration",
    {
      verbose: z.boolean().optional().describe("Include tables, env names, and sync metadata"),
    },
    async ({ verbose }) => textResult(summarizeStorageStatus(getStorageStatus(), Boolean(verbose))),
  );

  server.tool(
    "storage_push",
    "Push open-styles local SQLite tables to configured remote Postgres storage",
    {
      tables: z.array(z.string()).optional().describe("Optional storage table names"),
      dry_run: z.boolean().optional().describe("Report rows without writing remote storage"),
      verbose: z.boolean().optional().describe("Include per-table sync details"),
    },
    async ({ tables, dry_run, verbose }) => textResult(summarizeSyncResult(await storagePush({ tables, dryRun: dry_run }), Boolean(verbose))),
  );

  server.tool(
    "storage_pull",
    "Pull open-styles remote Postgres tables into local SQLite storage",
    {
      tables: z.array(z.string()).optional().describe("Optional storage table names"),
      dry_run: z.boolean().optional().describe("Report rows without writing local storage"),
      verbose: z.boolean().optional().describe("Include per-table sync details"),
    },
    async ({ tables, dry_run, verbose }) => textResult(summarizeSyncResult(await storagePull({ tables, dryRun: dry_run }), Boolean(verbose))),
  );

  server.tool(
    "storage_sync",
    "Push then pull open-styles storage tables",
    {
      tables: z.array(z.string()).optional().describe("Optional storage table names"),
      dry_run: z.boolean().optional().describe("Report rows without writing storage"),
      verbose: z.boolean().optional().describe("Include per-table sync details"),
    },
    async ({ tables, dry_run, verbose }) => textResult(summarizeSyncResult(await storageSync({ tables, dryRun: dry_run }), Boolean(verbose))),
  );

  server.tool(
    "storage_artifacts_status",
    "Show open-styles S3 screenshot artifact storage configuration",
    {
      verbose: z.boolean().optional().describe("Include env names"),
    },
    async ({ verbose }) => {
      const status = getStorageS3Status();
      return textResult({
        configured: status.configured,
        bucket: status.bucket,
        prefix: status.prefix,
        region: status.region,
        endpoint: status.endpoint ? truncateText(status.endpoint, 120) : null,
        ...(verbose ? { env: status.env } : {}),
        hint: "Pass verbose=true for env names.",
      });
    },
  );

  server.tool(
    "storage_artifacts_upload",
    "Upload local open-styles kit screenshots to configured S3 storage",
    {
      verbose: z.boolean().optional().describe("Include error details"),
    },
    async ({ verbose }) => textResult(summarizeArtifactResult(await storageArtifactsUpload(), Boolean(verbose))),
  );

  server.tool(
    "storage_artifacts_download",
    "Download open-styles kit screenshots from configured S3 storage",
    {
      verbose: z.boolean().optional().describe("Include error details"),
    },
    async ({ verbose }) => textResult(summarizeArtifactResult(await storageArtifactsDownload(), Boolean(verbose))),
  );
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: prettyJson(value) }],
  };
}

function summarizeStorageStatus(status: ReturnType<typeof getStorageStatus>, verbose: boolean) {
  return {
    configured: status.configured,
    mode: status.mode,
    activeEnv: status.activeEnv,
    tableCount: status.tables.length,
    s3: {
      configured: status.s3.configured,
      bucket: status.s3.bucket,
      prefix: status.s3.prefix,
      region: status.s3.region,
    },
    syncTables: status.sync.length,
    ...(verbose ? { env: status.env, deprecatedEnv: status.deprecatedEnv, tables: status.tables, sync: status.sync, s3Env: status.s3.env } : {}),
    hint: "Pass verbose=true for tables/env/sync metadata.",
  };
}

function summarizeSyncResult(result: SyncResult, verbose: boolean) {
  const pushed = result.tables.reduce((sum, row) => sum + row.pushed, 0);
  const pulled = result.tables.reduce((sum, row) => sum + row.pulled, 0);
  const skipped = result.tables.reduce((sum, row) => sum + row.skipped, 0);
  return {
    mode: result.mode,
    dryRun: result.dryRun,
    tableCount: result.tables.length,
    rows: { pushed, pulled, skipped },
    errors: verbose ? result.errors : result.errors.slice(0, 5).map((err) => truncateText(err, 160)),
    ...(verbose ? { tables: result.tables } : {}),
    hint: "Pass verbose=true for per-table sync details.",
  };
}

function summarizeArtifactResult(result: ArtifactSyncResult, verbose: boolean) {
  return {
    uploaded: result.uploaded,
    downloaded: result.downloaded,
    skipped: result.skipped,
    errors: verbose ? result.errors : result.errors.slice(0, 5).map((err) => truncateText(err, 160)),
    hint: "Pass verbose=true for full error details.",
  };
}
