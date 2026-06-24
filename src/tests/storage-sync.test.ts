import { afterEach, describe, expect, test } from "bun:test";
import {
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageS3Status,
  getStorageStatus,
  storageArtifactsUpload,
} from "../lib/storage-sync";

const ENV_NAMES = [
  "HASNA_STYLES_DATABASE_URL",
  "STYLES_DATABASE_URL",
  "HASNA_STYLES_STORAGE_MODE",
  "STYLES_STORAGE_MODE",
  "HASNA_STYLES_S3_BUCKET",
  "HASNA_STYLES_S3_PREFIX",
  "HASNA_STYLES_AWS_REGION",
  "HASNA_STYLES_S3_ENDPOINT",
  "AWS_REGION",
  "AWS_ENDPOINT",
  "S3_REGION",
  "S3_ENDPOINT",
] as const;

const oldEnv = new Map<string, string | undefined>();

for (const name of ENV_NAMES) {
  oldEnv.set(name, process.env[name]);
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = oldEnv.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("styles storage sync configuration", () => {
  test("reports canonical database envs without deprecated names", () => {
    expect(getStorageDatabaseEnv()).toEqual([
      { name: "HASNA_STYLES_DATABASE_URL", deprecated: false },
      { name: "STYLES_DATABASE_URL", deprecated: false },
    ]);
  });

  test("prefers the canonical storage database URL", () => {
    process.env["HASNA_STYLES_DATABASE_URL"] = "postgres://canonical";
    process.env["STYLES_DATABASE_URL"] = "postgres://fallback";

    expect(getStorageDatabaseUrl()).toEqual({
      name: "HASNA_STYLES_DATABASE_URL",
      deprecated: false,
      value: "postgres://canonical",
    });
    expect(getStorageMode()).toBe("remote");
  });

  test("supports local remote and hybrid modes without cloud aliases", () => {
    delete process.env["HASNA_STYLES_DATABASE_URL"];
    delete process.env["STYLES_DATABASE_URL"];
    expect(getStorageMode()).toBe("local");

    process.env["HASNA_STYLES_STORAGE_MODE"] = "hybrid";
    expect(getStorageMode()).toBe("hybrid");

    process.env["HASNA_STYLES_STORAGE_MODE"] = "cloud";
    expect(() => getStorageMode()).toThrow("Invalid HASNA_STYLES_STORAGE_MODE");
  });

  test("reports S3 artifact storage configuration", () => {
    process.env["HASNA_STYLES_S3_BUCKET"] = "style-artifacts";
    process.env["HASNA_STYLES_S3_PREFIX"] = "styles/prod/";
    process.env["HASNA_STYLES_AWS_REGION"] = "us-east-1";

    expect(getStorageS3Status()).toMatchObject({
      configured: true,
      bucket: "style-artifacts",
      prefix: "styles/prod",
      region: "us-east-1",
    });
  });

  test("storage status includes tables, S3 status, and no deprecated envs", () => {
    const status = getStorageStatus();
    expect(status.deprecatedEnv).toEqual([]);
    expect(status.tables).toContain("style_profiles");
    expect(status.tables).toContain("extracted_style_kits");
    expect(status.s3.env.bucket).toEqual(["HASNA_STYLES_S3_BUCKET"]);
  });

  test("artifact upload fails locally when no bucket is configured", async () => {
    delete process.env["HASNA_STYLES_S3_BUCKET"];
    await expect(storageArtifactsUpload()).resolves.toEqual({
      uploaded: 0,
      downloaded: 0,
      skipped: 0,
      errors: ["Missing HASNA_STYLES_S3_BUCKET"],
    });
  });

  test("exports database and artifact helpers from the storage subpath source", async () => {
    const storage = await import("../storage.js");

    expect(storage.STORAGE_TABLES.map((table) => table.name)).toContain("style_profiles");
    expect(storage.getStorageDatabaseUrl({})).toBeNull();
    expect(storage.getStorageMode({})).toBe("local");
    expect(storage.getStorageS3Status({}).configured).toBe(false);
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
  });
});
