/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server build for easy Docker / Railway / Render deploys.
  output: 'standalone',
  // Prisma has first-class Next handling — keep it external so the engine loads at runtime.
  serverExternalPackages: ['@prisma/client', 'prisma'],

  webpack: (config, { isServer, nextRuntime }) => {
    // Next also builds an Edge variant of instrumentation. Our server code is Node-only
    // (it returns early on Edge), but the bundler still has to resolve its imports —
    // and `node:*` builtins aren't resolvable there. Alias them away for that build.
    if (nextRuntime === 'edge') {
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:crypto': false,
        crypto: false,
      };
    }
    if (isServer) {
      // Keep these Node-native packages out of the bundle entirely. Telegraf (and its
      // transitive deps like safe-compare) `require('crypto')`/`require('path')`, which
      // must stay as runtime requires rather than being bundled.
      config.externals = [
        ...(config.externals || []),
        'telegraf',
        'pino',
        'pino-pretty',
        'ioredis',
      ];
    }
    return config;
  },
};

export default nextConfig;
