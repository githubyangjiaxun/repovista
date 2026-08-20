import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const specificationPath = new URL("../openapi/openapi.json", import.meta.url);
const routeSourcePaths = [
  new URL("../apps/api/src/app.ts", import.meta.url),
  new URL("../apps/api/src/routes.ts", import.meta.url),
];
const HTTP_METHODS = new Set(["delete", "get", "head", "options", "patch", "post", "put"]);

function fail(message) {
  console.error(`OpenAPI validation failed: ${message}`);
  process.exitCode = 1;
}

function normalizeFastifyPath(route) {
  return route.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function resolveParameter(specification, candidate) {
  const prefix = "#/components/parameters/";
  if (typeof candidate?.$ref !== "string" || !candidate.$ref.startsWith(prefix)) return candidate;
  return specification.components?.parameters?.[candidate.$ref.slice(prefix.length)];
}

function resolveSchema(specification, candidate) {
  const prefix = "#/components/schemas/";
  if (typeof candidate?.$ref !== "string" || !candidate.$ref.startsWith(prefix)) return candidate;
  return specification.components?.schemas?.[candidate.$ref.slice(prefix.length)];
}

const specification = JSON.parse(await readFile(specificationPath, "utf8"));

if (specification.openapi !== "3.1.0") {
  fail(`expected OpenAPI 3.1.0, received ${String(specification.openapi)}`);
}
if (!specification.info?.title || !specification.info?.version) {
  fail("info.title and info.version are required");
}
if (!specification.paths || typeof specification.paths !== "object") {
  fail("paths must be an object");
}

const implemented = new Set();
const routePattern = /app\.(delete|get|head|options|patch|post|put)\(\s*["'`]([^"'`]+)["'`]/g;
for (const sourcePath of routeSourcePaths) {
  const source = await readFile(sourcePath, "utf8");
  for (const match of source.matchAll(routePattern)) {
    implemented.add(`${match[1].toUpperCase()} ${normalizeFastifyPath(match[2])}`);
  }
}

const documented = new Set();
const operationIds = new Set();
for (const [route, pathItem] of Object.entries(specification.paths)) {
  if (!route.startsWith("/")) fail(`path must start with '/': ${route}`);
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!HTTP_METHODS.has(method)) continue;
    const key = `${method.toUpperCase()} ${route}`;
    documented.add(key);
    if (!operation.operationId) {
      fail(`${key} is missing operationId`);
    } else if (operationIds.has(operation.operationId)) {
      fail(`duplicate operationId: ${operation.operationId}`);
    } else {
      operationIds.add(operation.operationId);
    }
    if (
      !operation.responses ||
      !Object.keys(operation.responses).some((status) => /^2\d\d$/.test(status))
    ) {
      fail(`${key} must document a successful 2xx response`);
    }
    for (const parameterName of route.matchAll(/\{([^}]+)\}/g)) {
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
      const parameter = parameters
        .map((candidate) => resolveParameter(specification, candidate))
        .find((candidate) => candidate.name === parameterName[1] && candidate.in === "path");
      if (!parameter || parameter.required !== true) {
        fail(`${key} must declare required path parameter ${parameterName[1]}`);
      }
    }
  }
}

for (const route of implemented) {
  if (!documented.has(route)) fail(`implemented route is undocumented: ${route}`);
}
for (const route of documented) {
  if (!implemented.has(route)) fail(`documented route is not implemented: ${route}`);
}

const shareContent = specification.components?.schemas?.ShareReportContent;
const shareVariants = shareContent?.oneOf?.map((candidate) =>
  resolveSchema(specification, candidate),
);
if (!Array.isArray(shareVariants) || shareVariants.length !== 2) {
  fail("ShareReportContent must document Architecture Story v2 and legacy Tour v1");
} else {
  const story = shareVariants.find((variant) => variant?.properties?.version?.const === 2);
  const legacy = shareVariants.find(
    (variant) =>
      variant?.properties?.version?.const === 1 && !variant?.required?.includes("version"),
  );
  if (!story || !legacy) {
    fail("ShareReportContent must retain an unversioned legacy variant and version 2 Story");
  }
  for (const field of [
    "headline",
    "metrics",
    "map",
    "keyModules",
    "readingPath",
    "evidenceHighlights",
    "provenance",
  ]) {
    if (!story?.required?.includes(field)) fail(`ArchitectureStoryV2 must require ${field}`);
  }
}

if (process.exitCode) process.exit();
console.log(
  `OpenAPI contract is valid: ${documented.size} operations match the Fastify routes in ${root}.`,
);
