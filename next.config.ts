import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // V4 P1: LangGraph SqliteSaver uses better-sqlite3 (native module) in server route handlers.
  // Must stay external to webpack bundling.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
