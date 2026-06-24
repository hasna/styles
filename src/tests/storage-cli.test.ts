import { describe, expect, test } from "bun:test";
import { join } from "path";

const repoRoot = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runCli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("styles storage CLI", () => {
  test("advertises storage commands without legacy cloud commands", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("storage");
    expect(result.stdout).not.toMatch(/\n\s+cloud(?:\s|$)/);
  });

  test("prints compact storage status by default", async () => {
    const result = await runCli(["storage", "status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Storage: local");
    expect(result.stdout).toContain("Tables: 9");
    expect(result.stdout).toContain("Use --verbose");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test("prints storage status as JSON when requested", async () => {
    const result = await runCli(["storage", "status", "--json"]);
    const status = JSON.parse(result.stdout) as {
      configured: boolean;
      mode: string;
      env: string[];
      deprecatedEnv: string[];
      tables: string[];
      s3: { configured: boolean };
    };

    expect(result.exitCode).toBe(0);
    expect(status.configured).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.env).toEqual(["HASNA_STYLES_DATABASE_URL", "STYLES_DATABASE_URL"]);
    expect(status.deprecatedEnv).toEqual([]);
    expect(status.tables).toContain("style_profiles");
    expect(status.s3.configured).toBe(false);
  });

  test("prints artifact status from canonical S3 envs", async () => {
    const result = await runCli(["storage", "artifacts", "status", "--json"], {
      HASNA_STYLES_S3_BUCKET: "style-artifacts",
      HASNA_STYLES_S3_PREFIX: "styles/prod",
      HASNA_STYLES_AWS_REGION: "us-east-1",
    });
    const status = JSON.parse(result.stdout) as {
      configured: boolean;
      bucket: string;
      prefix: string;
      region: string;
    };

    expect(result.exitCode).toBe(0);
    expect(status).toMatchObject({
      configured: true,
      bucket: "style-artifacts",
      prefix: "styles/prod",
      region: "us-east-1",
    });
  });
});
