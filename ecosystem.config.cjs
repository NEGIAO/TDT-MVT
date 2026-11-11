module.exports = {
  apps: [
    {
      name: 'tdt-mvt-service',
      script: 'server.mjs',
      instances: 'max',       // 利用 VPS 全部 CPU 核心开启集群模式
      exec_mode: 'cluster',
      env: {
        PORT: 8890,
        NODE_ENV: 'production'
      },
      env_file: '.env',
      max_memory_restart: '800M',
      watch: false
    }
  ]
};
