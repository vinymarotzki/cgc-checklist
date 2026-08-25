const nextConfig = {
  output: "standalone",
  // Bind mount do Windows para o WSL2 do Docker Desktop não propaga eventos
  // de arquivo (inotify), só polling detecta as mudanças pra hot-reload.
  ...(process.env.WATCHPACK_POLLING === "true" && {
    webpack: (config) => {
      config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
      return config;
    },
  }),
};

module.exports = nextConfig;
