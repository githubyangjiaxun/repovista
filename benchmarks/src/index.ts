import { performance } from "node:perf_hooks";
import { parseRepository } from "@repovista/parser";
import { buildRetrievalQualityReport } from "./retrieval-quality.js";

const startedAt = performance.now();
const parsed = parseRepository([]);
const elapsed = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      benchmarks: [
        {
          benchmark: "empty-parser-baseline",
          files: parsed.length,
          elapsedMs: Number(elapsed.toFixed(3)),
        },
        buildRetrievalQualityReport(),
      ],
      node: process.version,
      platform: process.platform,
    },
    null,
    2,
  ),
);
