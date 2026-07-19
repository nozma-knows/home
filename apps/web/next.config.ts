import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@home/ui"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
