import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (no full node_modules needed at runtime).
  output: "standalone",
  // Monorepo: trace dependencies from the workspace root so hoisted pnpm packages are included.
  outputFileTracingRoot: join(__dirname, "../.."),
  poweredByHeader: false,
};

export default nextConfig;
