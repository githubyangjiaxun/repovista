import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const profileSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string().min(1),
  apiUrl: z.url(),
  token: z.string().regex(/^rv_[A-Za-z0-9_-]{32,}$/),
  login: z.string().nullable(),
});

const configSchema = z.object({
  version: z.literal(1),
  activeWorkspaceId: z.string().uuid().nullable(),
  profiles: z.record(z.string().uuid(), profileSchema),
});

export type CliProfile = z.infer<typeof profileSchema>;
export type CliConfig = z.infer<typeof configSchema>;

export const emptyCliConfig = (): CliConfig => ({
  version: 1,
  activeWorkspaceId: null,
  profiles: {},
});

export class CliConfigError extends Error {
  readonly code = "CLI_CONFIG_INVALID";

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliConfigError";
  }
}

export function cliConfigPath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  if (environment.REPOVISTA_CONFIG_PATH) return path.resolve(environment.REPOVISTA_CONFIG_PATH);
  const root = environment.XDG_CONFIG_HOME
    ? path.resolve(environment.XDG_CONFIG_HOME)
    : path.join(homeDirectory, ".config");
  return path.join(root, "repovista", "config.json");
}

export async function loadCliConfig(filePath: string): Promise<CliConfig> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCliConfig();
    throw new CliConfigError("RepoVista could not read the CLI configuration.", { cause: error });
  }
  try {
    return configSchema.parse(JSON.parse(content));
  } catch (error) {
    throw new CliConfigError(
      "The RepoVista CLI configuration is invalid. Move it aside and sign in again.",
      { cause: error },
    );
  }
}

export async function saveCliConfig(filePath: string, config: CliConfig): Promise<void> {
  const validated = configSchema.parse(config);
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function activeCliProfile(config: CliConfig): CliProfile | null {
  return config.activeWorkspaceId ? (config.profiles[config.activeWorkspaceId] ?? null) : null;
}

export function upsertCliProfile(config: CliConfig, profile: CliProfile): CliConfig {
  return {
    ...config,
    activeWorkspaceId: profile.workspaceId,
    profiles: { ...config.profiles, [profile.workspaceId]: profile },
  };
}

export function removeActiveCliProfile(config: CliConfig): CliConfig {
  if (!config.activeWorkspaceId) return config;
  const profiles = { ...config.profiles };
  delete profiles[config.activeWorkspaceId];
  return {
    ...config,
    activeWorkspaceId: Object.keys(profiles).sort()[0] ?? null,
    profiles,
  };
}
