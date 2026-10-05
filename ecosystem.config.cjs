// pm2 process definition — run with:  pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'hoteldemo',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 8097,
        SITE_URL: 'https://hoteldemo1.signaturediversified.com',
        // ADMIN_PASSPHRASE: 'hoteldemo', // uncomment to force a passphrase from here
      },
    },
  ],
};
