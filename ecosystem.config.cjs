/**
 * PM2 config for LT-IDP (web server).
 * Start: pm2 start ecosystem.config.cjs
 * Or:    pm2 start   (loads ecosystem.config.js → this file)
 *
 * Override: export PORT=3001 DATA_DIR=/path/to/data before pm2 start
 */
const path = require('path');

module.exports = {
  apps: [{
    name: 'lt-idp',
    script: 'dist-server/server/index.js',
    cwd: __dirname,
    env: {
      PORT: process.env.PORT || 3001,
      DATA_DIR: process.env.DATA_DIR || path.join(__dirname, 'data'),
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
  }],
};
