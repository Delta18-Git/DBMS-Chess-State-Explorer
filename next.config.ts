import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Do not (re)generate AGENTS.md on `next dev`.
  agentRules: false,
};
export default config;
