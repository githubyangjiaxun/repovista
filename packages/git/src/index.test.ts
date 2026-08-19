import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { languageForPath, parseGitHubUrl, scanWorkspace } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "repovista-git-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("parseGitHubUrl", () => {
  it("canonicalizes a GitHub repository URL", () => {
    expect(parseGitHubUrl("https://github.com/acme/demo.git")).toEqual({
      owner: "acme",
      name: "demo",
      canonicalUrl: "https://github.com/acme/demo",
      cloneUrl: "https://github.com/acme/demo.git",
    });
  });

  it("rejects credentials and non-GitHub hosts", () => {
    expect(() => parseGitHubUrl("https://user:pass@github.com/acme/demo")).toThrow();
    expect(() => parseGitHubUrl("https://example.com/acme/demo")).toThrow();
    expect(() => parseGitHubUrl("http://github.com/acme/demo")).toThrow();
    expect(() => parseGitHubUrl("https://github.com/acme/demo/issues")).toThrow();
    expect(() => parseGitHubUrl("https://github.com/acme/demo?token=secret")).toThrow();
  });
});

describe("languageForPath", () => {
  it("recognizes TypeScript variants", () => {
    expect(languageForPath("src/index.ts")).toBe("typescript");
    expect(languageForPath("src/view.tsx")).toBe("typescript");
  });
});

describe("scanWorkspace", () => {
  it("indexes safe text while excluding binary, generated, ignored, and secret files", async () => {
    const directory = await temporaryDirectory();
    await mkdir(path.join(directory, "src"), { recursive: true });
    await mkdir(path.join(directory, "dist"), { recursive: true });
    await writeFile(path.join(directory, "src", "index.ts"), "export const ready = true;\n");
    await writeFile(path.join(directory, "src", "ignored.ts"), "export const ignored = true;\n");
    await writeFile(path.join(directory, "dist", "bundle.js"), "generated\n");
    await writeFile(path.join(directory, ".env.local"), "SECRET=value\n");
    await writeFile(path.join(directory, "binary.dat"), Buffer.from([1, 0, 2]));

    const files = await scanWorkspace({
      directory,
      maxFiles: 10,
      maxBytes: 10_000,
      maxFileBytes: 1_000,
      ignore: ["src/ignored.ts"],
    });

    expect(files.map((file) => file.path)).toEqual(["src/index.ts"]);
    expect(files[0]).toMatchObject({ language: "typescript", lineCount: 2 });
  });

  it("rejects symbolic links before reading their target", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "outside.ts"), "export const secret = true;\n");
    await symlink(path.join(directory, "outside.ts"), path.join(directory, "linked.ts"));

    await expect(
      scanWorkspace({
        directory,
        maxFiles: 10,
        maxBytes: 10_000,
        maxFileBytes: 1_000,
      }),
    ).rejects.toMatchObject({ code: "REPOSITORY_SYMLINK_REJECTED" });
  });

  it("enforces file and byte limits", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "one.ts"), "12345");
    await writeFile(path.join(directory, "two.ts"), "67890");

    await expect(
      scanWorkspace({
        directory,
        maxFiles: 1,
        maxBytes: 100,
        maxFileBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "REPOSITORY_TOO_LARGE" });
    await expect(
      scanWorkspace({
        directory,
        maxFiles: 10,
        maxBytes: 6,
        maxFileBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "REPOSITORY_TOO_LARGE" });
  });
});
