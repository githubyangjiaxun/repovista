import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@repovista/contracts", "@repovista/ui"],
};

export default nextConfig;
