const nextConfig = {
  outputFileTracingRoot: __dirname,
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
};

module.exports = nextConfig;
