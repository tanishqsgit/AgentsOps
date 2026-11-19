import type { NextConfig } from 'next';

export default {
  output: 'standalone',
  agentRules: false,
  turbopack: { root: import.meta.dirname },
} satisfies NextConfig;
