import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  DEFAULT_RELEASE_BUDGETS,
  collectReleaseMetrics,
  createReleaseManifest,
  evaluateReleaseBudgets,
  formatBytes,
  parseByteSize,
  productArtifactNames,
} from "../scripts/releasePipeline.mjs";

describe("release packaging pipeline helpers", () => {
  test("parses and formats binary byte sizes", () => {
    expect(parseByteSize("25MiB")).toBe(25 * 1024 * 1024);
    expect(parseByteSize("3 MiB")).toBe(3 * 1024 * 1024);
    expect(parseByteSize("512KiB")).toBe(512 * 1024);
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MiB");
  });

  test("derives expected macOS artifact names", () => {
    expect(
      productArtifactNames({
        productName: "Personal Excalidraw Files",
        version: "0.1.10",
        arch: "aarch64",
      }),
    ).toEqual({
      appBundleName: "Personal Excalidraw Files.app",
      dmgName: "Personal Excalidraw Files_0.1.10_aarch64.dmg",
    });
  });

  test("collects release metrics and sorts large JavaScript assets first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "release-metrics-"));
    const appBundlePath = path.join(root, "Example.app");
    const dmgPath = path.join(root, "Example.dmg");
    const distPath = path.join(root, "dist");
    const assetsPath = path.join(distPath, "assets");
    const binaryPath = path.join(root, "example-bin");

    await mkdir(appBundlePath, { recursive: true });
    await mkdir(assetsPath, { recursive: true });
    await writeFile(path.join(appBundlePath, "Contents"), "app-bundle");
    await writeFile(dmgPath, "dmg");
    await writeFile(binaryPath, "binary");
    await writeFile(path.join(assetsPath, "small.js"), "12345");
    await writeFile(path.join(assetsPath, "large.js"), "1234567890");
    await writeFile(path.join(assetsPath, "style.css"), "ignored");

    const metrics = await collectReleaseMetrics({
      appBundlePath,
      dmgPath,
      distPath,
      binaryPath,
    });

    expect(metrics.dmgBytes).toBe(3);
    expect(metrics.appBundleBytes).toBe(10);
    expect(metrics.distBytes).toBe(22);
    expect(metrics.binaryBytes).toBe(6);
    expect(metrics.jsAssets.map((asset) => asset.name)).toEqual([
      "large.js",
      "small.js",
    ]);
    expect(metrics.largestJsBytes).toBe(10);
    expect(metrics.totalJsBytes).toBe(15);
  });

  test("fails release budget evaluation when an artifact exceeds its ceiling", () => {
    const result = evaluateReleaseBudgets(
      {
        dmgBytes: parseByteSize("26MiB"),
        appBundleBytes: parseByteSize("25MiB"),
        distBytes: parseByteSize("22MiB"),
        largestJsBytes: parseByteSize("2MiB"),
        totalJsBytes: parseByteSize("8MiB"),
      },
      DEFAULT_RELEASE_BUDGETS,
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        label: "DMG",
        actual: "26.0 MiB",
        limit: "25.0 MiB",
      }),
    ]);
  });

  test("builds a release manifest even when budgets fail", () => {
    const metrics = {
      dmgBytes: parseByteSize("26MiB"),
      appBundleBytes: parseByteSize("25MiB"),
      distBytes: parseByteSize("22MiB"),
      binaryBytes: parseByteSize("24MiB"),
      largestJsBytes: parseByteSize("2MiB"),
      totalJsBytes: parseByteSize("8MiB"),
      jsAssets: [
        {
          name: "index.js",
          path: "assets/index.js",
          bytes: parseByteSize("2MiB"),
          formatted: "2.0 MiB",
        },
      ],
    };
    const budgetResult = evaluateReleaseBudgets(
      metrics,
      DEFAULT_RELEASE_BUDGETS,
    );

    const manifest = createReleaseManifest({
      generatedAt: "2026-05-26T00:00:00.000Z",
      gitCommit: "abc123",
      productName: "Personal Excalidraw Files",
      version: "0.1.10",
      arch: "aarch64",
      paths: {
        appBundlePath: "/tmp/Personal Excalidraw Files.app",
        dmgPath: "/tmp/Personal Excalidraw Files_0.1.10_aarch64.dmg",
        binaryPath: "/tmp/personal-excalidraw",
        distPath: "/tmp/dist",
      },
      metrics,
      budgets: DEFAULT_RELEASE_BUDGETS,
      budgetResult,
      dmgSha256: "hash",
    });

    expect(manifest.budgets.passed).toBe(false);
    expect(manifest.budgets.checks[0]).toEqual(
      expect.objectContaining({ label: "DMG", ok: false }),
    );
    expect(manifest.topJsAssets).toHaveLength(1);
  });
});
