import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const rawPort = process.env.WEB_PORT ?? process.env.PORT ?? "3000";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`WEB_PORT must be an integer between 1 and 65535; received ${rawPort}.`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "--port", String(port)], {
  env: { ...process.env, PORT: String(port) },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
