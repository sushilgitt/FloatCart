const path = require("path");

module.exports = {
  apps: [
    {
      name: "floating-solnix",
      cwd: path.join(__dirname, "web"),
      script: "npm",
      args: "run serve",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 3106,
        HOST: "https://floating.solnix.store",
        SHOPIFY_APP_URL: "https://floating.solnix.store",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3106,
        HOST: "https://floating.solnix.store",
        SHOPIFY_APP_URL: "https://floating.solnix.store",
      },
    },
  ],
};
