import type { NextConfig } from "next";

// Where the Express API lives. Locally that's localhost:4000; in Docker it's the "server" service.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone, which keeps the Docker image small.
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  // The browser only ever talks to this Next.js app. Requests to /api/* are forwarded to Express,
  // so frontend and API share one origin: no CORS setup, and the httpOnly auth cookie just works.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
