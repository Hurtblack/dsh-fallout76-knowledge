import { Settings } from '../lib/settings.js';
import { KnowledgeStore } from '../lib/store.js';
import { starterCatalog } from '../lib/starter.js';
const settings = new Settings(), config = settings.read(), args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--peer' || !config.allowedPeers.includes(args[1])) {
  throw Error('Usage: node scripts/import-starter.mjs --peer group_YOUR_GROUP (must already be in allowedPeers)');
}
const result = new KnowledgeStore(config.dataDir).importStarter(args[1], starterCatalog());
console.log(JSON.stringify({ ...result, peer: args[1], dataDir: config.dataDir, message: '仅补入基础资料；未启用聊天学习或QQ发送' }, null, 2));
