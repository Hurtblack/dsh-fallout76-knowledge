import fs from 'node:fs';
import { KnowledgeStore, text } from './store.js';
const catalogPath = new URL('../data/starter.zh-CN.json', import.meta.url);
let cached;
export function starterCatalog() {
  if (cached) return cached;
  const pack = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (pack.schema !== 1 || !Array.isArray(pack.entries) || pack.entries.length > 500) throw Error('Invalid starter catalog');
  text(pack.id, 80, 'catalog id'); text(pack.revision, 80, 'catalog revision');
  const ids = new Set();
  for (const entry of pack.entries) {
    if (entry.classification === 'time-limited' || 'validFrom' in entry || 'validUntil' in entry) throw Error('Time-limited snapshots cannot be bundled as evergreen knowledge');
    text(entry.id, 80, 'seed id'); text(entry.title, 100, 'title'); text(entry.body, 1800, 'body');
    if (ids.has(entry.id)) throw Error('Duplicate starter id'); ids.add(entry.id);
    if (!['reference', 'experience'].includes(entry.status)) throw Error('Invalid starter status');
    if (!Array.isArray(entry.tags) || !Array.isArray(entry.sources) || !entry.sources.length) throw Error('Starter sources required');
    if (!Number.isInteger(entry.reviewAfterDays) || entry.reviewAfterDays < 1 || entry.reviewAfterDays > 730) throw Error('Invalid starter review interval');
    for (const source of entry.sources) {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || !['help.bethesda.net', 'fallout.bethesda.net', 'fallout.fandom.com', 'fallout.wiki', 'tieba.baidu.com', 'c.tieba.baidu.com'].includes(url.hostname)) throw Error('Untrusted starter source URL');
      if (!['official', 'wiki', 'community'].includes(source.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)) throw Error('Invalid starter source metadata');
    }
  }
  cached = pack; return cached;
}
// Only the bundled, reviewed catalog is imported; chat/model tools cannot call a
// general external import endpoint or self-assign reference/verified status.
export function ensureStarter(config) {
  if (!config.enabled || !config.allowedPeers.length) return { added: 0, available: starterCatalog().entries.length };
  const pack = starterCatalog(), store = new KnowledgeStore(config.dataDir);
  let added = 0;
  for (const peer of config.allowedPeers) added += store.importStarter(peer, pack).added;
  return { added, available: pack.entries.length, revision: pack.revision };
}
