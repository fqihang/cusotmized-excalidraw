#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIB = 1024 * 1024;

export const parseByteSize = (value) => {
  if (typeof value === "number") {
    return value;
  }
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kib|kb|mib|mb)?$/i);
  if (!match) {
    throw new Error(`Invalid byte size: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  if (unit === "b") {
    return Math.round(amount);
  }
  if (unit === "kib" || unit === "kb") {
    return Math.round(amount * 1024);
  }
  if (unit === "mib" || unit === "mb") {
    return Math.round(amount * MIB);
  }
  throw new Error(`Unsupported byte size unit: ${unit}`);
};

export const formatBytes = (bytes) => `${(bytes / MIB).toFixed(1)} MiB`;

export const DEFAULT_RELEASE_BUDGETS = Object.freeze({
  dmgMaxBytes: parseByteSize("25MiB"),
  appBundleMaxBytes: parseByteSize("40MiB"),
  distMaxBytes: parseByteSize("30MiB"),
  largestJsMaxBytes: parseByteSize("3MiB"),
  totalJsMaxBytes: parseByteSize("12MiB"),
});

export const productArtifactNames = ({ productName, version, arch }) => ({
  appBundleName: `${productName}.app`,
  dmgName: `${productName}_${version}_${arch}.dmg`,
});

const exists = async (targetPath) => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const directorySize = async (targetPath) => {
  const targetStat = await stat(targetPath);
  if (!targetStat.isDirectory()) {
    return targetStat.size;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map((entry) => directorySize(path.join(targetPath, entry.name))),
  );
  return sizes.reduce((total, size) => total + size, 0);
};

const walkFiles = async (directoryPath) => {
  if (!(await exists(directoryPath))) {
    return [];
  }
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(entryPath);
      }
      if (entry.isFile()) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat();
};

export const collectReleaseMetrics = async ({
  appBundlePath,
  dmgPath,
  distPath,
  binaryPath,
}) => {
  const assetFiles = await walkFiles(path.join(distPath, "assets"));
  const jsAssets = await Promise.all(
    assetFiles
      .filter((assetPath) => assetPath.endsWith(".js"))
      .map(async (assetPath) => {
        const fileStat = await stat(assetPath);
        return {
          name: path.basename(assetPath),
          path: path.relative(distPath, assetPath),
          bytes: fileStat.size,
          formatted: formatBytes(fileStat.size),
        };
      }),
  );

  jsAssets.sort((left, right) => right.bytes - left.bytes);

  return {
    dmgBytes: await directorySize(dmgPath),
    appBundleBytes: await directorySize(appBundlePath),
    distBytes: await directorySize(distPath),
    binaryBytes: await directorySize(binaryPath),
    largestJsBytes: jsAssets[0]?.bytes ?? 0,
    totalJsBytes: jsAssets.reduce((total, asset) => total + asset.bytes, 0),
    jsAssets,
  };
};

export const evaluateReleaseBudgets = (
  metrics,
  budgets = DEFAULT_RELEASE_BUDGETS,
) => {
  const checks = [
    ["DMG", metrics.dmgBytes, budgets.dmgMaxBytes],
    ["App bundle", metrics.appBundleBytes, budgets.appBundleMaxBytes],
    ["Frontend dist", metrics.distBytes, budgets.distMaxBytes],
    ["Largest JS asset", metrics.largestJsBytes, budgets.largestJsMaxBytes],
    ["Total JS assets", metrics.totalJsBytes, budgets.totalJsMaxBytes],
  ].map(([label, actualBytes, limitBytes]) => ({
    label,
    actualBytes,
    limitBytes,
    actual: formatBytes(actualBytes),
    limit: formatBytes(limitBytes),
    ok: actualBytes <= limitBytes,
  }));

  return {
    ok: checks.every((check) => check.ok),
    checks,
    failures: checks.filter((check) => !check.ok),
  };
};

const runCommand = (command, args, { cwd = APP_ROOT, env = process.env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });

const runQuietCommand = (command, args, { cwd = APP_ROOT } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code}\n${stderr}`,
        ),
      );
    });
  });

const runStep = async (label, action) => {
  console.log(`\n==> ${label}`);
  await action();
};

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const currentGitCommit = async () => {
  try {
    return await runQuietCommand("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(APP_ROOT, "..", ".."),
    });
  } catch {
    return null;
  }
};

const readTauriConfig = async () => {
  const configPath = path.join(APP_ROOT, "src-tauri", "tauri.conf.json");
  return JSON.parse(await readFile(configPath, "utf8"));
};

const targetArch = () => {
  if (process.env.TAURI_ARCH) {
    return process.env.TAURI_ARCH;
  }
  if (process.env.CARGO_BUILD_TARGET?.includes("aarch64")) {
    return "aarch64";
  }
  if (process.env.CARGO_BUILD_TARGET?.includes("x86_64")) {
    return "x64";
  }
  return process.arch === "arm64" ? "aarch64" : process.arch;
};

const artifactPaths = ({ productName, version, arch }) => {
  const names = productArtifactNames({ productName, version, arch });
  const releasePath = path.join(APP_ROOT, "src-tauri", "target", "release");
  return {
    ...names,
    appBundlePath: path.join(releasePath, "bundle", "macos", names.appBundleName),
    dmgPath: path.join(releasePath, "bundle", "dmg", names.dmgName),
    distPath: path.join(APP_ROOT, "dist"),
    binaryPath: path.join(releasePath, "personal-excalidraw"),
    manifestPath: path.join(releasePath, "bundle", "release-manifest.json"),
  };
};

const cleanupTransientDmgVolumes = async () => {
  if (process.platform !== "darwin") {
    return [];
  }
  const volumesRoot = "/Volumes";
  const entries = await readdir(volumesRoot, { withFileTypes: true });
  const transientVolumes = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("dmg."))
    .map((entry) => path.join(volumesRoot, entry.name));

  for (const volumePath of transientVolumes) {
    try {
      await runCommand("hdiutil", ["detach", volumePath], { cwd: APP_ROOT });
    } catch (error) {
      console.warn(`Warning: failed to detach ${volumePath}: ${error.message}`);
    }
  }

  return transientVolumes;
};

const verifyDmg = async (dmgPath) => {
  if (process.platform !== "darwin") {
    console.log("Skipping hdiutil verify outside macOS.");
    return;
  }
  await runCommand("hdiutil", ["verify", dmgPath], { cwd: APP_ROOT });
};

export const createReleaseManifest = ({
  generatedAt,
  gitCommit,
  productName,
  version,
  arch,
  paths,
  metrics,
  budgets,
  budgetResult,
  dmgSha256,
}) => ({
  generatedAt,
  gitCommit,
  productName,
  version,
  arch,
  artifacts: {
    appBundle: paths.appBundlePath,
    dmg: paths.dmgPath,
    binary: paths.binaryPath,
    frontendDist: paths.distPath,
    dmgSha256,
  },
  sizes: {
    dmg: { bytes: metrics.dmgBytes, formatted: formatBytes(metrics.dmgBytes) },
    appBundle: {
      bytes: metrics.appBundleBytes,
      formatted: formatBytes(metrics.appBundleBytes),
    },
    frontendDist: {
      bytes: metrics.distBytes,
      formatted: formatBytes(metrics.distBytes),
    },
    binary: {
      bytes: metrics.binaryBytes,
      formatted: formatBytes(metrics.binaryBytes),
    },
    largestJsAsset: {
      bytes: metrics.largestJsBytes,
      formatted: formatBytes(metrics.largestJsBytes),
    },
    totalJsAssets: {
      bytes: metrics.totalJsBytes,
      formatted: formatBytes(metrics.totalJsBytes),
    },
  },
  budgets: {
    dmgMax: formatBytes(budgets.dmgMaxBytes),
    appBundleMax: formatBytes(budgets.appBundleMaxBytes),
    frontendDistMax: formatBytes(budgets.distMaxBytes),
    largestJsMax: formatBytes(budgets.largestJsMaxBytes),
    totalJsMax: formatBytes(budgets.totalJsMaxBytes),
    passed: budgetResult.ok,
    checks: budgetResult.checks,
  },
  topJsAssets: metrics.jsAssets.slice(0, 12),
});

const writeManifest = async ({
  productName,
  version,
  arch,
  paths,
  metrics,
  budgets,
  budgetResult,
  dmgSha256,
}) => {
  const manifest = createReleaseManifest({
    generatedAt: new Date().toISOString(),
    gitCommit: await currentGitCommit(),
    productName,
    version,
    arch,
    paths,
    metrics,
    budgets,
    budgetResult,
    dmgSha256,
  });

  await mkdir(path.dirname(paths.manifestPath), { recursive: true });
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

const parseArgs = (argv) => {
  const args = new Set(argv);
  return {
    help: args.has("--help") || args.has("-h"),
    skipChecks: args.has("--skip-checks"),
    skipTauriBuild: args.has("--skip-tauri-build"),
    skipDmgVerify: args.has("--skip-dmg-verify"),
  };
};

const printHelp = () => {
  console.log(`Usage: npm run package:release -- [options]

Runs the product release pipeline:
  - app tests and TypeScript checks
  - Rust tests
  - stale transient DMG volume cleanup
  - Tauri app + DMG build
  - DMG checksum verification
  - artifact size and JavaScript bundle budgets
  - release-manifest.json generation

Options:
  --skip-checks       Skip npm test, typecheck, and cargo test.
  --skip-tauri-build  Reuse existing release artifacts.
  --skip-dmg-verify   Skip hdiutil DMG checksum verification.
`);
};

const printSummary = ({ paths, metrics, budgetResult, dmgSha256 }) => {
  console.log("\nRelease artifacts");
  console.log(`  DMG: ${paths.dmgPath}`);
  console.log(`  App: ${paths.appBundlePath}`);
  console.log(`  Manifest: ${paths.manifestPath}`);
  console.log(`  SHA256: ${dmgSha256}`);
  console.log("\nSize budgets");
  for (const check of budgetResult.checks) {
    console.log(
      `  ${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.actual} / ${check.limit}`,
    );
  }
  console.log("\nTop JavaScript assets");
  for (const asset of metrics.jsAssets.slice(0, 8)) {
    console.log(`  ${asset.formatted} ${asset.path}`);
  }
};

export const runReleasePipeline = async (argv = process.argv.slice(2)) => {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return null;
  }

  const tauriConfig = await readTauriConfig();
  const productName = tauriConfig.productName;
  const version = tauriConfig.version;
  const arch = targetArch();
  const paths = artifactPaths({ productName, version, arch });

  if (!options.skipChecks) {
    await runStep("Run app tests", () => runCommand("npm", ["test"]));
    await runStep("Run TypeScript checks", () =>
      runCommand("npm", ["run", "typecheck"]),
    );
    await runStep("Run Rust tests", () =>
      runCommand("cargo", ["test"], {
        cwd: path.join(APP_ROOT, "src-tauri"),
      }),
    );
  }

  await runStep("Clean transient DMG build mounts", async () => {
    const detached = await cleanupTransientDmgVolumes();
    if (detached.length === 0) {
      console.log("No transient DMG volumes found.");
    } else {
      console.log(`Detached ${detached.length} transient volume(s).`);
    }
  });

  if (!options.skipTauriBuild) {
    await runStep("Build Tauri release bundles", () =>
      runCommand("npm", ["run", "tauri:build"]),
    );
  }

  if (!options.skipDmgVerify) {
    await runStep("Verify DMG checksum", () => verifyDmg(paths.dmgPath));
  }

  const metrics = await collectReleaseMetrics(paths);
  const budgetResult = evaluateReleaseBudgets(metrics, DEFAULT_RELEASE_BUDGETS);
  const dmgSha256 = await sha256File(paths.dmgPath);

  await runStep("Write release manifest", async () => {
    await writeManifest({
      productName,
      version,
      arch,
      paths,
      metrics,
      budgets: DEFAULT_RELEASE_BUDGETS,
      budgetResult,
      dmgSha256,
    });
  });

  printSummary({ paths, metrics, budgetResult, dmgSha256 });

  if (!budgetResult.ok) {
    throw new Error(
      `Release artifact budget failed: ${budgetResult.failures
        .map((failure) => `${failure.label} ${failure.actual} > ${failure.limit}`)
        .join(", ")}`,
    );
  }

  return { paths, metrics, budgetResult, dmgSha256 };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReleasePipeline().catch((error) => {
    console.error(`\nRelease pipeline failed: ${error.message}`);
    process.exit(1);
  });
}
