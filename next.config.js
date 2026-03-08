/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,

  // Moved out of experimental in Next.js 15+
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pdfmake'],

  // Silence the Turbopack/webpack warning — empty config opts in to Turbopack cleanly
  turbopack: {},

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'poultryfarm-pro-uploads.s3.af-south-1.amazonaws.com',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin',      value: process.env.NEXT_PUBLIC_APP_URL || '*' },
          { key: 'Access-Control-Allow-Methods',     value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers',     value: 'Authorization,Content-Type' },
        ],
      },
    ];
  },

  async redirects() {
    return [
      { source: '/', destination: '/auth/login', permanent: false },
    ];
  },
};

module.exports = nextConfig;
