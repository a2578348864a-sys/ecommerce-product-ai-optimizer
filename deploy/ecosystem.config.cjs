// PM2 example for Alibaba AI Assistant.
//
// Recommended project directory:
//   /www/alibaba-ai-assistant
//
// If your real project directory is different, replace cwd below with your actual path.
//
// Equivalent command:
//   pm2 start npm --name alibaba-ai-assistant -- run start -- -H 127.0.0.1 -p 3005

module.exports = {
  apps: [
    {
      name: "alibaba-ai-assistant",
      cwd: "/www/alibaba-ai-assistant",
      script: "npm",
      args: "run start -- -H 127.0.0.1 -p 3005",
      env_file: "/www/alibaba-ai-assistant/.env.local",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
