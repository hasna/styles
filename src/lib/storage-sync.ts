import type { PoolClient } from "pg";
import type { SQLQueryBindings } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { basename, dirname } from "path";
import { getDb } from "./db.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

export type StorageMode = "local" | "remote" | "hybrid";

export interface StorageEnv {
  name: string;
  deprecated: boolean;
}

export interface SyncTableResult {
  table: string;
  pushed: number;
  pulled: number;
  skipped: number;
}

export interface SyncResult {
  mode: StorageMode;
  dryRun: boolean;
  tables: SyncTableResult[];
  errors: string[];
}

export interface SyncMeta {
  table: string;
  lastPushedAt: string | null;
  lastPulledAt: string | null;
  lastRemoteRows: number | null;
  updatedAt: string;
}

export interface StorageS3Config {
  bucket: string;
  prefix: string;
  region: string | null;
  endpoint: string | null;
}

export interface StorageS3Status {
  configured: boolean;
  bucket: string | null;
  prefix: string;
  region: string | null;
  endpoint: string | null;
  env: {
    bucket: readonly string[];
    prefix: readonly string[];
    region: readonly string[];
    endpoint: readonly string[];
  };
}

export interface ArtifactSyncResult {
  uploaded: number;
  downloaded: number;
  skipped: number;
  errors: string[];
}

interface StorageTable {
  name: string;
  primaryKey: string;
  columns: readonly string[];
}

const DATABASE_ENV_NAMES: readonly StorageEnv[] = [
  { name: "HASNA_STYLES_DATABASE_URL", deprecated: false },
  { name: "STYLES_DATABASE_URL", deprecated: false },
];

const MODE_ENV_NAMES = ["HASNA_STYLES_STORAGE_MODE", "STYLES_STORAGE_MODE"] as const;
const S3_BUCKET_ENV_NAMES = ["HASNA_STYLES_S3_BUCKET"] as const;
const S3_PREFIX_ENV_NAMES = ["HASNA_STYLES_S3_PREFIX"] as const;
const S3_REGION_ENV_NAMES = ["HASNA_STYLES_AWS_REGION", "AWS_REGION", "S3_REGION"] as const;
const S3_ENDPOINT_ENV_NAMES = ["HASNA_STYLES_S3_ENDPOINT", "AWS_ENDPOINT", "S3_ENDPOINT"] as const;

export const STORAGE_TABLES: readonly StorageTable[] = [
  {
    name: "style_profiles",
    primaryKey: "id",
    columns: ["id", "name", "display_name", "description", "category", "principles", "anti_patterns", "typography", "colors", "component_rules", "tags", "created_at"],
  },
  {
    name: "preferences",
    primaryKey: "id",
    columns: ["id", "key", "value", "scope", "project_path", "updated_at"],
  },
  {
    name: "project_configs",
    primaryKey: "id",
    columns: ["id", "project_path", "profile_id", "active_template_id", "custom_overrides", "hook_installed", "created_at"],
  },
  {
    name: "templates",
    primaryKey: "id",
    columns: ["id", "name", "description", "style_profile_id", "variables", "created_at"],
  },
  {
    name: "health_checks",
    primaryKey: "id",
    columns: ["id", "project_path", "run_at", "violations", "score", "status", "cerebras_used"],
  },
  {
    name: "health_violations",
    primaryKey: "id",
    columns: ["id", "check_id", "file_path", "rule", "message", "severity", "auto_task_id"],
  },
  {
    name: "extracted_style_kits",
    primaryKey: "id",
    columns: ["id", "name", "url", "tokens", "raw", "screenshot", "tags", "notes", "extracted_at", "created_at", "updated_at"],
  },
  {
    name: "agent_presence",
    primaryKey: "agent",
    columns: ["id", "agent", "session_id", "role", "project_id", "status", "last_seen_at", "created_at", "metadata"],
  },
  {
    name: "feedback",
    primaryKey: "id",
    columns: ["id", "message", "email", "category", "version", "machine_id", "created_at"],
  },
] as const;

export function getStorageDatabaseEnv(): readonly StorageEnv[] {
  return DATABASE_ENV_NAMES;
}

export function getStorageDatabaseUrl(env: Record<string, string | undefined> = process.env): StorageEnv & { value: string } | null {
  for (const entry of DATABASE_ENV_NAMES) {
    const value = env[entry.name]?.trim();
    if (value) return { ...entry, value };
  }
  return null;
}

export function getStorageMode(env: Record<string, string | undefined> = process.env): StorageMode {
  for (const name of MODE_ENV_NAMES) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (value === "local" || value === "remote" || value === "hybrid") return value;
    throw new Error(`Invalid ${name}: expected local, remote, or hybrid`);
  }
  return getStorageDatabaseUrl(env) ? "remote" : "local";
}

export function getStorageS3Config(env: Record<string, string | undefined> = process.env): StorageS3Config | null {
  const bucket = readFirstEnv(S3_BUCKET_ENV_NAMES, env);
  if (!bucket) return null;
  return {
    bucket,
    prefix: normalizeS3Prefix(readFirstEnv(S3_PREFIX_ENV_NAMES, env) ?? "open-styles"),
    region: readFirstEnv(S3_REGION_ENV_NAMES, env),
    endpoint: readFirstEnv(S3_ENDPOINT_ENV_NAMES, env),
  };
}

export function getStorageS3Status(env: Record<string, string | undefined> = process.env): StorageS3Status {
  const config = getStorageS3Config(env);
  return {
    configured: Boolean(config),
    bucket: config?.bucket ?? null,
    prefix: config?.prefix ?? "open-styles",
    region: config?.region ?? null,
    endpoint: config?.endpoint ?? null,
    env: {
      bucket: S3_BUCKET_ENV_NAMES,
      prefix: S3_PREFIX_ENV_NAMES,
      region: S3_REGION_ENV_NAMES,
      endpoint: S3_ENDPOINT_ENV_NAMES,
    },
  };
}

export function getStorageStatus() {
  const activeEnv = getStorageDatabaseUrl();
  return {
    configured: Boolean(activeEnv),
    mode: getStorageMode(),
    env: DATABASE_ENV_NAMES.map((entry) => entry.name),
    deprecatedEnv: DATABASE_ENV_NAMES.filter((entry) => entry.deprecated).map((entry) => entry.name),
    activeEnv: activeEnv?.name ?? null,
    deprecatedActiveEnv: activeEnv?.deprecated ?? false,
    tables: STORAGE_TABLES.map((table) => table.name),
    s3: getStorageS3Status(),
    sync: getSyncMetaAll(),
  };
}

export async function runStorageMigrations(client?: PoolClient): Promise<void> {
  if (client) {
    for (const migration of PG_MIGRATIONS) {
      await client.query(migration);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS styles_sync_meta (
        table_name TEXT PRIMARY KEY,
        last_pushed_at TIMESTAMPTZ,
        last_pulled_at TIMESTAMPTZ,
        last_remote_rows INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return;
  }

  ensureLocalSyncMetaTable();
}

export function getSyncMetaAll(): SyncMeta[] {
  ensureLocalSyncMetaTable();
  const rows = getDb()
    .prepare("SELECT * FROM storage_sync_meta ORDER BY table_name")
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    table: row.table_name as string,
    lastPushedAt: (row.last_pushed_at as string | null) ?? null,
    lastPulledAt: (row.last_pulled_at as string | null) ?? null,
    lastRemoteRows: row.last_remote_rows == null ? null : Number(row.last_remote_rows),
    updatedAt: row.updated_at as string,
  }));
}

export async function storagePush(options: { tables?: string[]; dryRun?: boolean } = {}): Promise<SyncResult> {
  const mode = getStorageMode();
  const result = createSyncResult(mode, Boolean(options.dryRun));
  const selectedTables = selectTables(options.tables);
  const databaseUrl = getStorageDatabaseUrl();

  if (!databaseUrl) {
    result.errors.push("Missing HASNA_STYLES_DATABASE_URL or STYLES_DATABASE_URL");
    return result;
  }

  await withStorageClient(databaseUrl.value, async (client) => {
    await runStorageMigrations(client);
    for (const table of selectedTables) {
      const rows = loadLocalRows(table);
      result.tables.push({ table: table.name, pushed: options.dryRun ? 0 : rows.length, pulled: 0, skipped: options.dryRun ? rows.length : 0 });
      if (!options.dryRun) {
        for (const row of rows) {
          await upsertRemoteRow(client, table, row);
        }
        updateLocalSyncMeta(table.name, { lastPushedAt: new Date().toISOString(), lastRemoteRows: rows.length });
      }
    }
  });

  return result;
}

export async function storagePull(options: { tables?: string[]; dryRun?: boolean } = {}): Promise<SyncResult> {
  const mode = getStorageMode();
  const result = createSyncResult(mode, Boolean(options.dryRun));
  const selectedTables = selectTables(options.tables);
  const databaseUrl = getStorageDatabaseUrl();

  if (!databaseUrl) {
    result.errors.push("Missing HASNA_STYLES_DATABASE_URL or STYLES_DATABASE_URL");
    return result;
  }

  await withStorageClient(databaseUrl.value, async (client) => {
    await runStorageMigrations(client);
    for (const table of selectedTables) {
      const rows = await loadRemoteRows(client, table);
      result.tables.push({ table: table.name, pushed: 0, pulled: options.dryRun ? 0 : rows.length, skipped: options.dryRun ? rows.length : 0 });
      if (!options.dryRun) {
        for (const row of rows) {
          upsertLocalRow(table, row);
        }
        updateLocalSyncMeta(table.name, { lastPulledAt: new Date().toISOString(), lastRemoteRows: rows.length });
      }
    }
  });

  return result;
}

export async function storageSync(options: { tables?: string[]; dryRun?: boolean } = {}): Promise<SyncResult> {
  const push = await storagePush(options);
  if (push.errors.length > 0) return push;

  const pull = await storagePull(options);
  return {
    mode: push.mode,
    dryRun: Boolean(options.dryRun),
    tables: [...push.tables, ...pull.tables],
    errors: pull.errors,
  };
}

export async function storageArtifactsUpload(): Promise<ArtifactSyncResult> {
  const result = createArtifactResult();
  const config = getStorageS3Config();
  if (!config) {
    result.errors.push("Missing HASNA_STYLES_S3_BUCKET");
    return result;
  }

  const client = createS3Client(config);
  for (const row of listKitScreenshotRows()) {
    if (!row.screenshot || !existsSync(row.screenshot)) {
      result.skipped += 1;
      continue;
    }
    await client.file(getArtifactKey(config.prefix, row.id, row.screenshot)).write(Bun.file(row.screenshot));
    result.uploaded += 1;
  }
  return result;
}

export async function storageArtifactsDownload(): Promise<ArtifactSyncResult> {
  const result = createArtifactResult();
  const config = getStorageS3Config();
  if (!config) {
    result.errors.push("Missing HASNA_STYLES_S3_BUCKET");
    return result;
  }

  const client = createS3Client(config);
  for (const row of listKitScreenshotRows()) {
    if (!row.screenshot) {
      result.skipped += 1;
      continue;
    }
    if (existsSync(row.screenshot)) {
      result.skipped += 1;
      continue;
    }
    const object = client.file(getArtifactKey(config.prefix, row.id, row.screenshot));
    mkdirSync(dirname(row.screenshot), { recursive: true });
    await Bun.write(row.screenshot, object);
    result.downloaded += 1;
  }
  return result;
}

function createSyncResult(mode: StorageMode, dryRun: boolean): SyncResult {
  return { mode, dryRun, tables: [], errors: [] };
}

function createArtifactResult(): ArtifactSyncResult {
  return { uploaded: 0, downloaded: 0, skipped: 0, errors: [] };
}

function ensureLocalSyncMetaTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS storage_sync_meta (
      table_name TEXT PRIMARY KEY,
      last_pushed_at TEXT,
      last_pulled_at TEXT,
      last_remote_rows INTEGER,
      updated_at TEXT NOT NULL
    )
  `);
}

function updateLocalSyncMeta(tableName: string, patch: { lastPushedAt?: string; lastPulledAt?: string; lastRemoteRows?: number }): void {
  ensureLocalSyncMetaTable();
  const now = new Date().toISOString();
  getDb().run(
    `INSERT INTO storage_sync_meta (table_name, last_pushed_at, last_pulled_at, last_remote_rows, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(table_name) DO UPDATE SET
       last_pushed_at = COALESCE(excluded.last_pushed_at, storage_sync_meta.last_pushed_at),
       last_pulled_at = COALESCE(excluded.last_pulled_at, storage_sync_meta.last_pulled_at),
       last_remote_rows = COALESCE(excluded.last_remote_rows, storage_sync_meta.last_remote_rows),
       updated_at = excluded.updated_at`,
    [tableName, patch.lastPushedAt ?? null, patch.lastPulledAt ?? null, patch.lastRemoteRows ?? null, now],
  );
}

async function withStorageClient<T>(databaseUrl: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

function selectTables(names?: string[]): readonly StorageTable[] {
  if (!names || names.length === 0) return STORAGE_TABLES;
  const wanted = new Set(names);
  const selected = STORAGE_TABLES.filter((table) => wanted.has(table.name));
  const missing = [...wanted].filter((name) => !STORAGE_TABLES.some((table) => table.name === name));
  if (missing.length > 0) throw new Error(`Unknown storage table(s): ${missing.join(", ")}`);
  return selected;
}

function loadLocalRows(table: StorageTable): Array<Record<string, unknown>> {
  const columns = table.columns.map(quoteSql).join(", ");
  return getDb().prepare(`SELECT ${columns} FROM ${quoteSql(table.name)}`).all() as Array<Record<string, unknown>>;
}

async function loadRemoteRows(client: PoolClient, table: StorageTable): Promise<Array<Record<string, unknown>>> {
  const columns = table.columns.map(quoteSql).join(", ");
  const response = await client.query(`SELECT ${columns} FROM ${quoteSql(table.name)}`);
  return response.rows.map(normalizeRemoteRow);
}

async function upsertRemoteRow(client: PoolClient, table: StorageTable, row: Record<string, unknown>): Promise<void> {
  const columns = table.columns;
  const values = columns.map((column) => row[column] ?? null);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const updates = columns
    .filter((column) => column !== table.primaryKey)
    .map((column) => `${quoteSql(column)} = EXCLUDED.${quoteSql(column)}`)
    .join(", ");

  await client.query(
    `INSERT INTO ${quoteSql(table.name)} (${columns.map(quoteSql).join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (${quoteSql(table.primaryKey)}) DO UPDATE SET ${updates}`,
    values,
  );
}

function upsertLocalRow(table: StorageTable, row: Record<string, unknown>): void {
  const columns = table.columns;
  const values = columns.map((column) => normalizeLocalValue(row[column])) as SQLQueryBindings[];
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== table.primaryKey)
    .map((column) => `${quoteSql(column)} = excluded.${quoteSql(column)}`)
    .join(", ");

  getDb().run(
    `INSERT INTO ${quoteSql(table.name)} (${columns.map(quoteSql).join(", ")})
     VALUES (${placeholders})
     ON CONFLICT(${quoteSql(table.primaryKey)}) DO UPDATE SET ${updates}`,
    values,
  );
}

function normalizeRemoteRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeLocalValue(value)]),
  );
}

function normalizeLocalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function quoteSql(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function readFirstEnv(names: readonly string[], env: Record<string, string | undefined>): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeS3Prefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "") || "open-styles";
}

function createS3Client(config: StorageS3Config): Bun.S3Client {
  return new Bun.S3Client({
    bucket: config.bucket,
    region: config.region ?? undefined,
    endpoint: config.endpoint ?? undefined,
  });
}

function listKitScreenshotRows(): Array<{ id: string; screenshot: string | null }> {
  return getDb()
    .prepare("SELECT id, screenshot FROM extracted_style_kits WHERE screenshot IS NOT NULL ORDER BY id")
    .all() as Array<{ id: string; screenshot: string | null }>;
}

function getArtifactKey(prefix: string, kitId: string, filePath: string): string {
  return `${prefix}/kits/${kitId}/${basename(filePath)}`;
}
