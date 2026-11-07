import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Do not (re)generate AGENTS.md on `next dev`.
  agentRules: false,
  // The Stockfish engine runs as a child process from node_modules; never bundle it.
  serverExternalPackages: ["stockfish"],
  // Let the dev server hydrate pages opened as http://127.0.0.1:3000 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
};
export default config;
