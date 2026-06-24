import { describe, expect, test } from "bun:test";
import { PACKAGE_VERSION } from "../version";

describe("package version metadata", () => {
  test("matches package.json", async () => {
    const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json() as {
      version: string;
    };

    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });
});
