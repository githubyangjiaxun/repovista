import { performance } from "node:perf_hooks";
import { parseRepository } from "@repovista/parser";

const startedAt = performance.now();
const parsed = parseRepository([]);
const elapsed = performance.now() - startedAt;

console.log(
  JSON.stringify({
    benchmark: "empty-parser-baseline",
    files: parsed.length,
    elapsedMs: Number(elapsed.toFixed(3)),
    node: process.version,
    platform: process.platform,
  }),
);
