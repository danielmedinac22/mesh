/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@anthropic-ai/claude-agent-sdk"],
  },
};

export default nextConfig;
