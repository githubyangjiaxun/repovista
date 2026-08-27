import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default(false);

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalPositiveInteger = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  API_ORIGIN: z.url().default("http://localhost:4000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://repovista:repovista@localhost:5432/repovista"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  MODEL_PROVIDER: z.enum(["none", "fake", "ollama", "openai-compatible"]).default("fake"),
  OPENAI_COMPATIBLE_BASE_URL: optionalText,
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  CHAT_MODEL: optionalText,
  EMBEDDING_PROVIDER: z.enum(["none", "ollama", "openai-compatible"]).default("none"),
  EMBEDDING_MODEL: optionalText,
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(64).default(16),
  EMBEDDING_INPUT_MAX_CHARS: z.coerce.number().int().min(256).max(100_000).default(12_000),
  EMBEDDING_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  REPOSITORY_ALLOWED_HOSTS: z.string().default("github.com"),
  REPOSITORY_MAX_FILES: z.coerce.number().int().positive().default(10_000),
  REPOSITORY_MAX_BYTES: z.coerce.number().int().positive().default(524_288_000),
  SOURCE_FILE_MAX_BYTES: z.coerce.number().int().positive().default(2_097_152),
  JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1_000),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(5).default(30),
  WORKER_ID: z.string().min(1).default("local-worker"),
  ANONYMOUS_IMPORTS_PER_HOUR: z.coerce.number().int().positive().default(3),
  ANONYMOUS_QUESTIONS_PER_HOUR: z.coerce.number().int().positive().default(10),
  SHARE_REPORTS_PER_HOUR: z.coerce.number().int().positive().default(10),
  GITHUB_WEBHOOK_SECRET: optionalSecret,
  GITHUB_API_TOKEN: optionalSecret,
  GITHUB_API_ORIGIN: z.url().default("https://api.github.com"),
  GITHUB_APP_SLUG: z.string().trim().min(1).max(100).default("repovista-local"),
  GITHUB_APP_ID: optionalPositiveInteger,
  GITHUB_APP_CLIENT_ID: optionalText,
  GITHUB_APP_CLIENT_SECRET: optionalSecret,
  GITHUB_APP_PRIVATE_KEY: optionalSecret,
  GITHUB_OAUTH_ORIGIN: z.url().default("https://github.com"),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(2_592_000),
  AUTH_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  AUTH_COOKIE_DOMAIN: optionalText,
  AUTH_COOKIE_SECURE: booleanFromString,
  AUTH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  AUTH_ALLOW_SIGNUP: booleanFromString,
  GITHUB_WEBHOOK_BODY_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_485_760)
    .default(1_048_576),
  RUN_MIGRATIONS_ON_START: booleanFromString,
  DEMO_SEED_ENABLED: booleanFromString,
});

export type AppConfig = z.infer<typeof envSchema> & {
  repositoryAllowedHosts: readonly string[];
};

let cachedConfig: AppConfig | undefined;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(environment);
  if (
    parsed.APP_ENV === "production" &&
    (!parsed.WEB_ORIGIN.startsWith("https://") ||
      !parsed.API_ORIGIN.startsWith("https://") ||
      !parsed.AUTH_COOKIE_SECURE)
  ) {
    throw new Error(
      "Production RepoVista deployments require HTTPS WEB_ORIGIN/API_ORIGIN and AUTH_COOKIE_SECURE=true.",
    );
  }
  return {
    ...parsed,
    repositoryAllowedHosts: parsed.REPOSITORY_ALLOWED_HOSTS.split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = undefined;
}
