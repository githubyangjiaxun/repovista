import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { BUNDLED_DEMO_REPOSITORY } from "@repovista/contracts";
import type { ScannedFile } from "@repovista/domain";
import { scanWorkspace } from "@repovista/git";

export type BundledDemoVersionKey = "base" | "head";

export interface BundledDemoVersion {
  key: BundledDemoVersionKey;
  requestedRef: string;
  branch: string;
  commitSha: string;
  files: ScannedFile[];
}

export const BUNDLED_DEMO_VERSIONS: readonly BundledDemoVersionKey[] = ["base", "head"];

function fixtureDirectory(key: BundledDemoVersionKey): string {
  return fileURLToPath(new URL(`../fixtures/${key}/`, import.meta.url));
}

function fixtureRevision(files: readonly ScannedFile[]): string {
  const manifest = JSON.stringify(
    files.map((file) => ({
      path: file.path,
      contentHash: file.contentHash,
      byteSize: file.byteSize,
    })),
  );
  return createHash("sha256")
    .update(`repovista-bundled-demo-v1\n${manifest}`)
    .digest("hex")
    .slice(0, 40);
}

export async function loadBundledDemoVersion(
  key: BundledDemoVersionKey,
): Promise<BundledDemoVersion> {
  const files = await scanWorkspace({
    directory: fixtureDirectory(key),
    maxFiles: 100,
    maxBytes: 2 * 1024 * 1024,
    maxFileBytes: 256 * 1024,
  });
  return {
    key,
    requestedRef: `bundled-demo-${key}`,
    branch: BUNDLED_DEMO_REPOSITORY.defaultBranch,
    commitSha: fixtureRevision(files),
    files,
  };
}

export async function loadBundledDemoVersions(): Promise<{
  base: BundledDemoVersion;
  head: BundledDemoVersion;
}> {
  const [base, head] = await Promise.all([
    loadBundledDemoVersion("base"),
    loadBundledDemoVersion("head"),
  ]);
  return { base, head };
}
