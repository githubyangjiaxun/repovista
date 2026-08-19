import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(projectDirectory, "../.."),
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/@swc/helpers/**/*"],
  },
  transpilePackages: ["@repovista/contracts", "@repovista/ui"],
};

export default nextConfig;
