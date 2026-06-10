const fs = require('fs');
const path = require('path');
// Read lockfile
const lockfile = fs.readFileSync('pnpm-lock.yaml', 'utf8');
const entries = [];
lockfile.split('\n').forEach(line => {
  const m = line.match(/^  \/([^@]+)/);
  if (m) entries.push(m[1].toLowerCase());
});
console.log('Entries found in lockfile:', entries.length);
// Write to config
const configPath = path.join(process.env.HOME || '/home/kara', '.config/pnpm/approved-builds.json');
const dir = path.dirname(configPath);
fs.mkdirSync(dir, { recursive: true });
const approved = { approvedBuilds: ['better-sqlite3', 'esbuild'] };
fs.writeFileSync(configPath, JSON.stringify(approved, null, 2));
console.log('Wrote approved builds to', configPath);
