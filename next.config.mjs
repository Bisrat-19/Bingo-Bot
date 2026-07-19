/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server build for easy Docker / Railway / Render deploys.
  output: 'standalone',
  // Prisma has first-class Next handling — keep it external so the engine loads at runtime.
  serverExternalPackages: ['@prisma/client', 'prisma'],

  webpack: (config, { isServer }) => {
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
