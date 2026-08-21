import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeCliProfile,
  emptyCliConfig,
  loadCliConfig,
  saveCliConfig,
  upsertCliProfile,
} from "./config.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";

const profile = {
  workspaceId,
  workspaceName: "Private workspace",
  apiUrl: "https://api.example",
  token: "rv_abcdefghijklmnopqrstuvwxyz0123456789_-",
  login: "octocat",
};

describe("CLI configuration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("writes only a user-readable file and round-trips profiles", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "repovista-cli-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "nested", "config.json");
    const config = upsertCliProfile(emptyCliConfig(), profile);

    await saveCliConfig(filePath, config);

    const fileMode = (await stat(filePath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(await loadCliConfig(filePath)).toEqual(config);
    expect(await readFile(filePath, "utf8")).not.toContain("-----BEGIN");
    expect(activeCliProfile(config)).toEqual(profile);
  });
});
