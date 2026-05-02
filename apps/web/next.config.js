const path = require("path");

const apiInternalUrl = process.env.API_INTERNAL_URL || "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@ecoledigitale/contracts", "@ecoledigitale/ui", "@ecoledigitale/utils", "@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
  experimental: {
    typedRoutes: false, // Désactiver pour éviter les problèmes
    // Note: webpack tslib alias below is not mirrored here — Turbopack/SWC
    // resolves tslib correctly via pnpm without the v2 ES helpers workaround,
    // and absolute-path aliases are treated as external modules by Turbopack.
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Webpack config with improved chunk handling
  webpack: (config, { dev, isServer }) => {
    // Improve module resolution for monorepo
    config.resolve = {
      ...config.resolve,
      symlinks: false, // Disable symlinks for better module resolution in pnpm
      alias: {
        ...(config.resolve?.alias || {}),
        // Force tslib v2 helpers to avoid __spreadArray runtime import errors
        tslib: path.resolve(
          __dirname,
          "../../node_modules/.pnpm/tslib@2.8.1/node_modules/tslib/tslib.es6.js"
        ),
      },
    };

    if (dev && !isServer) {
      // In development, use Next.js default chunking but with better error handling
      // Don't override Next.js's optimized chunking strategy
      config.optimization = {
        ...config.optimization,
        // Keep Next.js defaults but ensure chunks are stable
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            default: {
              ...config.optimization.splitChunks?.cacheGroups?.default,
              reuseExistingChunk: true,
            },
          },
        },
      };
      
      // Improve error handling for chunk loading
      if (config.output) {
        config.output.chunkLoadTimeout = 120000; // 2 minutes timeout
      }

      // Improve HMR stability
      if (config.plugins) {
        // Ensure webpack hot module replacement is stable
        const hmrPlugin = config.plugins.find(
          (p) => p.constructor.name === 'HotModuleReplacementPlugin'
        );
        if (hmrPlugin) {
          // HMR is already configured by Next.js
        }
      }
    }
    return config;
  },
  async rewrites() {
    return [
      // Exclude specific routes that have Next.js API handlers
      // These must come BEFORE the catch-all rewrite
      {
        source: '/api/v1/parents/:id',
        destination: '/api/v1/parents/:id', // Let Next.js API route handle it
      },
      {
        source: '/api/v1/formations-pro/:id',
        destination: '/api/v1/formations-pro/:id', // Let Next.js API route handle it
      },
      {
        source: '/api/v1/formations-pro/:id/:path*',
        destination: '/api/v1/formations-pro/:id/:path*', // Let Next.js API route handle nested routes
      },
      {
        source: '/api/v1/files/:path*',
        destination: '/api/v1/files/:path*', // Let Next.js file proxy route handle auth headers
      },
      {
        source: '/api/v1/assignments/question-defaults',
        destination: '/api/v1/assignments/question-defaults',
      },
      {
        source: '/api/v1/assignments/upload-document',
        destination: '/api/v1/assignments/upload-document',
      },
      {
        source: '/api/v1/assignments/ai-evaluation',
        destination: '/api/v1/assignments/ai-evaluation',
      },
      {
        source: '/api/v1/assignments/:assignmentId',
        destination: '/api/v1/assignments/:assignmentId',
      },
      {
        source: '/api/v1/assignments/:assignmentId/questions',
        destination: '/api/v1/assignments/:assignmentId/questions',
      },
      {
        source: '/api/v1/assignments/:assignmentId/questions/bulk-placeholders',
        destination: '/api/v1/assignments/:assignmentId/questions/bulk-placeholders',
      },
      {
        source: '/api/v1/assignments/:assignmentId/questions/:questionId',
        destination: '/api/v1/assignments/:assignmentId/questions/:questionId',
      },
      {
        source: '/api/v1/semester-averages/attendance-certificates/pdf',
        destination: '/api/v1/semester-averages/attendance-certificates/pdf', // Route Next (proxy long PDF) — pas le rewrite vers :4000
      },
      {
        source: '/api/v1/semester-averages/report-cards/pdf',
        destination: '/api/v1/semester-averages/report-cards/pdf', // Route Next (proxy long PDF)
      },
      // Catch-all for all other /api/v1 routes
      {
        source: '/api/v1/:path*',
        destination: `${apiInternalUrl}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
