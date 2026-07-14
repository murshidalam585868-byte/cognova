import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: '.next',
  poweredByHeader: false,
  compress: true,
  experimental: {
    serverComponentsExternalPackages: ['bullmq', 'ioredis', 'winston'],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'brain.mr-imperfect.online',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.mr-imperfect.online',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/api/health',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=()',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/www/:path*',
        destination: 'https://brain.mr-imperfect.online/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
