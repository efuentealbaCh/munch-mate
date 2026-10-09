import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (no full node_modules needed at runtime).
  output: "standalone",
  // Monorepo: trace dependencies from the workspace root so hoisted pnpm packages are included.
  outputFileTracingRoot: join(__dirname, "../.."),
  poweredByHeader: false,
  async rewrites() {
    // In production Caddy routes /api/* to the api. In `pnpm dev` Next plays that role, so the browser
    // sees a single origin (localhost:3100) and the session cookies behave exactly as in production.
    if (process.env.NODE_ENV !== "development") return [];
    return [
      { source: "/api/:path*", destination: "http://localhost:3000/api/:path*" },
      // Socket.IO (staff board, order tracking). Long-polling works through the rewrite; the WebSocket upgrade
      // may not, and socket.io-client then keeps polling. In production Caddy proxies real WebSockets.
      // Next answers "/socket.io/" with a 308 to "/socket.io" (trailing-slash redirect, before rewrites), so
      // in dev the client asks for "/socket.io" (lib/realtime.ts) and the slash the api needs is added here.
      { source: "/socket.io", destination: "http://localhost:3000/socket.io/" },
    ];
  },
};

export default nextConfig;
