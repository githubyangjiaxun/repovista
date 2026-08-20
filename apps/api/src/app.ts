import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "@repovista/config";
import { getConfig } from "@repovista/config";
import { createDatabasePool, type DatabasePool, RepoVistaStore } from "@repovista/database";
import { isDomainError } from "@repovista/domain";
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "./routes.js";

type FastifyRequestWithRawBody = { rawBody?: Buffer };

export interface AppDependencies {
  config?: AppConfig;
  pool?: DatabasePool;
  store?: RepoVistaStore;
}

function hasHttpStatus(error: unknown): error is { message: string; statusCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export function buildApp(dependencies: AppDependencies = {}): {
  app: FastifyInstance;
  pool: DatabasePool;
  store: RepoVistaStore;
} {
  const config = dependencies.config ?? getConfig();
  const pool =
    dependencies.pool ?? createDatabasePool(config.DATABASE_URL, config.DATABASE_MAX_CONNECTIONS);
  const store = dependencies.store ?? new RepoVistaStore(pool);
  const app = Fastify({
    bodyLimit: config.GITHUB_WEBHOOK_BODY_MAX_BYTES,
    logger: {
      level: config.LOG_LEVEL,
    },
    requestIdHeader: "x-request-id",
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: config.GITHUB_WEBHOOK_BODY_MAX_BYTES },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (request.url === "/v1/integrations/github/webhooks") {
        (request as unknown as FastifyRequestWithRawBody).rawBody = rawBody;
        done(null, rawBody);
        return;
      }
      try {
        done(null, JSON.parse(rawBody.toString("utf8")));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  void app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: false,
  });
  void app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-ID", request.id);
    return payload;
  });

  app.get("/v1/health/live", async () => ({ status: "ok" }));
  app.get("/v1/health/ready", async (_request, reply) => {
    try {
      await store.ping();
      return { status: "ok" };
    } catch {
      reply.code(503);
      return { status: "unavailable" };
    }
  });

  registerRoutes(app, { config, store });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    if (isDomainError(error)) {
      const status = error.code.endsWith("NOT_FOUND")
        ? 404
        : error.code === "GITHUB_RATE_LIMITED"
          ? 429
          : error.code === "GITHUB_WEBHOOK_SIGNATURE_INVALID"
            ? 401
            : error.code === "GITHUB_APP_DISABLED"
              ? 503
              : error.code === "SNAPSHOT_NOT_READY" ||
                  error.code === "GITHUB_WEBHOOK_DELIVERY_CONFLICT" ||
                  error.code === "EXPORT_NOT_AVAILABLE" ||
                  error.code === "PR_ANALYSIS_REVISION_CONFLICT"
                ? 409
                : error.code === "GITHUB_API_FAILED"
                  ? 502
                  : error.code.startsWith("AI_")
                    ? 502
                    : 400;
      reply.status(status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          retryable: error.retryable,
          requestId: request.id,
        },
      });
      return;
    }
    if (hasHttpStatus(error) && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: {
          code: error.statusCode === 429 ? "RATE_LIMITED" : "REQUEST_FAILED",
          message: error.statusCode === 429 ? "Too many requests." : error.message,
          retryable: error.statusCode === 429,
          requestId: request.id,
        },
      });
      return;
    }
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        retryable: false,
        requestId: request.id,
      },
    });
  });

  app.addHook("onClose", async () => {
    if (!dependencies.pool) {
      await pool.end();
    }
  });

  return { app, pool, store };
}
