import path from 'node:path';
import fs from 'node:fs';
import { Settings } from '../lib/settings.js';
const args = process.argv.slice(2), settings = new Settings();
const patch = {};
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--data-dir': patch.dataDir = path.resolve(args[++i]); break;
    case '--napcat-db': patch.napcatDb = path.resolve(args[++i]); break;
    case '--group': { const n = args[++i]; if (!/^\d{5,14}$/.test(n || '')) throw Error('Invalid group'); patch.allowedPeers = [`group_${n}`]; break; }
    case '--disable': patch.enabled = false; break;
    case '--enable': patch.enabled = true; break;
    case '--help': console.log('node scripts/configure.mjs [--data-dir PATH] [--napcat-db PATH] [--group NUMBER] [--enable|--disable]\nDSH_HOME selects the DSH home directory. Existing files are not moved.'); process.exit(0);
    default: throw Error(`Unknown argument: ${args[i]}`);
  }
}
if (Object.keys(patch).length) {
  if (fs.existsSync(settings.file)) fs.copyFileSync(settings.file, `${settings.file}.${Date.now()}.bak`);
  settings.save(patch);
}
console.log(JSON.stringify({ file: settings.file, config: settings.read() }, null, 2));
