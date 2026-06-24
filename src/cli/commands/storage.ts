import type { Command } from "commander";
import { formatTable, jsonOut, truncateText } from "../../lib/format.js";
import {
  type ArtifactSyncResult,
  type StorageS3Status,
  type SyncResult,
  getStorageS3Status,
  getStorageStatus,
  storageArtifactsDownload,
  storageArtifactsUpload,
  storagePull,
  storagePush,
  storageSync,
} from "../../lib/storage-sync.js";

export function registerStorageCommands(program: Command): void {
  const storage = program
    .command("storage")
    .description("Inspect and sync open-styles local and remote storage");

  storage
    .command("status")
    .description("Show storage configuration and local sync metadata")
    .option("-v, --verbose", "Show table/env/sync details")
    .option("--json", "Output full JSON")
    .action((opts: { verbose?: boolean; json?: boolean }) => {
      const status = getStorageStatus();
      if (opts.json) jsonOut(status);
      else writeStorageStatus(status, opts.verbose);
    });

  storage
    .command("push")
    .description("Push local SQLite tables to remote Postgres storage")
    .option("--tables <tables>", "Comma-separated storage tables to sync")
    .option("--dry-run", "Report rows without writing remote storage")
    .option("--json", "Output full JSON")
    .action(async (opts: { tables?: string; dryRun?: boolean; json?: boolean }) => {
      const result = await storagePush({ tables: parseTables(opts.tables), dryRun: opts.dryRun });
      if (opts.json) jsonOut(result);
      else writeSyncResult("Storage push", result);
    });

  storage
    .command("pull")
    .description("Pull remote Postgres tables into local SQLite storage")
    .option("--tables <tables>", "Comma-separated storage tables to sync")
    .option("--dry-run", "Report rows without writing local storage")
    .option("--json", "Output full JSON")
    .action(async (opts: { tables?: string; dryRun?: boolean; json?: boolean }) => {
      const result = await storagePull({ tables: parseTables(opts.tables), dryRun: opts.dryRun });
      if (opts.json) jsonOut(result);
      else writeSyncResult("Storage pull", result);
    });

  storage
    .command("sync")
    .description("Push then pull storage tables")
    .option("--tables <tables>", "Comma-separated storage tables to sync")
    .option("--dry-run", "Report rows without writing storage")
    .option("--json", "Output full JSON")
    .action(async (opts: { tables?: string; dryRun?: boolean; json?: boolean }) => {
      const result = await storageSync({ tables: parseTables(opts.tables), dryRun: opts.dryRun });
      if (opts.json) jsonOut(result);
      else writeSyncResult("Storage sync", result);
    });

  const artifacts = storage
    .command("artifacts")
    .description("Inspect and sync screenshot artifacts with S3");

  artifacts
    .command("status")
    .description("Show S3 artifact storage configuration")
    .option("-v, --verbose", "Show env names")
    .option("--json", "Output full JSON")
    .action((opts: { verbose?: boolean; json?: boolean }) => {
      const status = getStorageS3Status();
      if (opts.json) jsonOut(status);
      else writeS3Status(status, opts.verbose);
    });

  artifacts
    .command("upload")
    .description("Upload local style kit screenshots to configured S3 storage")
    .option("--json", "Output full JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await storageArtifactsUpload();
      if (opts.json) jsonOut(result);
      else writeArtifactResult("Artifact upload", result);
    });

  artifacts
    .command("download")
    .description("Download style kit screenshots from configured S3 storage")
    .option("--json", "Output full JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await storageArtifactsDownload();
      if (opts.json) jsonOut(result);
      else writeArtifactResult("Artifact download", result);
    });
}

function parseTables(value: string | undefined): string[] | undefined {
  return value?.split(",").map((table) => table.trim()).filter(Boolean);
}

function writeStorageStatus(
  status: ReturnType<typeof getStorageStatus>,
  verbose = false,
): void {
  process.stdout.write(`Storage: ${status.mode} (${status.configured ? "remote configured" : "local only"})\n`);
  process.stdout.write(`Database env: ${status.activeEnv ?? status.env.join(", ")}\n`);
  process.stdout.write(`Tables: ${status.tables.length}\n`);
  process.stdout.write(`S3 artifacts: ${status.s3.configured ? "configured" : "not configured"} (prefix: ${status.s3.prefix})\n`);
  process.stdout.write(`Sync metadata: ${status.sync.length} table(s)\n`);

  if (verbose) {
    process.stdout.write("\nStorage tables\n");
    process.stdout.write(status.tables.map((table) => `  ${table}`).join("\n") + "\n");
    process.stdout.write("\nS3 env\n");
    process.stdout.write(formatTable(Object.entries(status.s3.env), [
      { header: "Field", value: ([field]) => field, maxWidth: 16 },
      { header: "Env", value: ([, names]) => names.join(", "), maxWidth: 72 },
    ]) + "\n");
    if (status.sync.length > 0) {
      process.stdout.write("\nSync metadata\n");
      process.stdout.write(formatTable(status.sync, [
        { header: "Table", value: (row) => row.table, maxWidth: 28 },
        { header: "Pushed", value: (row) => row.lastPushedAt ?? "-", maxWidth: 24 },
        { header: "Pulled", value: (row) => row.lastPulledAt ?? "-", maxWidth: 24 },
        { header: "Remote", value: (row) => row.lastRemoteRows ?? "-", maxWidth: 10 },
      ]) + "\n");
    }
  }

  process.stdout.write("Use --verbose for env/table details or --json for the full object.\n");
}

function writeS3Status(status: StorageS3Status, verbose = false): void {
  process.stdout.write(`S3 artifacts: ${status.configured ? "configured" : "not configured"}\n`);
  process.stdout.write(`Bucket: ${status.bucket ?? "-"}\n`);
  process.stdout.write(`Prefix: ${status.prefix}\n`);
  process.stdout.write(`Region: ${status.region ?? "-"}\n`);
  process.stdout.write(`Endpoint: ${truncateText(status.endpoint ?? "-", 72)}\n`);
  if (verbose) {
    process.stdout.write("\nEnv\n");
    process.stdout.write(formatTable(Object.entries(status.env), [
      { header: "Field", value: ([field]) => field, maxWidth: 16 },
      { header: "Env", value: ([, names]) => names.join(", "), maxWidth: 72 },
    ]) + "\n");
  }
  process.stdout.write("Use --verbose for env details or --json for the full object.\n");
}

function writeSyncResult(label: string, result: SyncResult): void {
  process.stdout.write(`${label}: ${result.mode}${result.dryRun ? " dry-run" : ""}\n`);
  process.stdout.write(`Tables: ${result.tables.length}\n`);
  const pushed = result.tables.reduce((sum, row) => sum + row.pushed, 0);
  const pulled = result.tables.reduce((sum, row) => sum + row.pulled, 0);
  const skipped = result.tables.reduce((sum, row) => sum + row.skipped, 0);
  process.stdout.write(`Rows: ${pushed} pushed, ${pulled} pulled, ${skipped} skipped\n`);
  if (result.errors.length > 0) {
    process.stdout.write(`Errors: ${result.errors.length}\n`);
    for (const err of result.errors.slice(0, 3)) process.stdout.write(`  ${truncateText(err, 120)}\n`);
    if (result.errors.length > 3) process.stdout.write(`  ... and ${result.errors.length - 3} more\n`);
  }
  process.stdout.write("Use --json for per-table details.\n");
}

function writeArtifactResult(label: string, result: ArtifactSyncResult): void {
  process.stdout.write(`${label}: ${result.errors.length > 0 ? "failed" : "complete"}\n`);
  process.stdout.write(`Artifacts: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.skipped} skipped\n`);
  if (result.errors.length > 0) {
    process.stdout.write(`Errors: ${result.errors.length}\n`);
    for (const err of result.errors.slice(0, 3)) process.stdout.write(`  ${truncateText(err, 120)}\n`);
  }
  process.stdout.write("Use --json for full details.\n");
}
