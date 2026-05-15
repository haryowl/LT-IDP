/**
 * Fails fast with a clear message when start:web is run before build:web.
 */
const fs = require('fs');
const path = require('path');

const entry = path.join(__dirname, '..', 'dist-server', 'server', 'index.js');
if (!fs.existsSync(entry)) {
  console.error('');
  console.error('The web server has not been built yet.');
  console.error('From the project root, run:');
  console.error('');
  console.error('  npm run build:web');
  console.error('');
  console.error('Then start again:');
  console.error('');
  console.error('  npm run start:web');
  console.error('');
  process.exit(1);
}
