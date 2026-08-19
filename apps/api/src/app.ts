import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "@repovista/config";
import { getConfig } from "@repovista/config";
import { createDatabasePool, type DatabasePool, RepoVistaStore } from "@repovista/database";
import { isDomainError } from "@repovista/domain";
import Fastify, { type FastifyInstance } from "fastify";

export interface AppDependencies {
  config?: AppConfig;
  pool?: DatabasePool;
  store?: RepoVistaStore;
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
    logger: {
      level: config.LOG_LEVEL,
    },
    requestIdHeader: "x-request-id",
  });

  void app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: false,
  });
  void app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
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

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    if (isDomainError(error)) {
      reply.status(error.code.endsWith("NOT_FOUND") ? 404 : 400).send({
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
