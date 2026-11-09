import fs from 'node:fs';
import { ensureStarter, starterCatalog } from './starter.js';
import { KnowledgeStore } from './store.js';
import { NapcatSource } from './source.js';
export const ROUTE = '/plugins/dsh-fallout76-knowledge/api';
function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 65536) throw Error('请求内容过长');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function createHandler({ settings, learner, authenticate }) {
  return async (req, res) => {
    // Plugin routes are not automatically authenticated by all DSH versions.
    let rejection;
    try { rejection = authenticate ? authenticate(req) : 403; } catch { rejection = 403; }
    if (rejection !== undefined) return send(res, rejection === 401 ? 401 : 403, { ok: false, error: '需要DSH宿主登录' });
    try {
      if (req.method === 'GET') {
        const c = settings.read(); ensureStarter(c); const store = new KnowledgeStore(c.dataDir), state = store.read();
        return send(res, 200, { ok: true, config: c, status: { busy: learner.busy, error: learner.lastError, sourceExists: fs.existsSync(c.napcatDb), count: state.entries.length, starterAvailable: starterCatalog().entries.length, starterCount: state.entries.filter(x => x.origin === 'starter').length, budget: state.budget, cursors: state.cursors } });
      }
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { ok: false, error: '仅接受同源管理请求' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { ok: false, error: '需要JSON请求' });
      const b = await bodyOf(req), c = settings.read(); ensureStarter(c); const store = new KnowledgeStore(c.dataDir);
      let result;
      switch (b.action) {
        case 'configure':
          if (!b.config || typeof b.config !== 'object' || Array.isArray(b.config)) throw Error('配置格式错误');
          learner.controller?.abort(); result = settings.save(b.config); break;
        case 'search':
          if (!c.allowedPeers.includes(b.peer)) throw Error('该会话未开放');
          if (typeof (b.query ?? '') !== 'string' || (b.query || '').length > 2400) throw Error('搜索内容过长');
          result = store.search(b.peer, b.query || '', { limit: 200, includeRetired: !!b.includeRetired, reviewAfterDays: c.reviewAfterDays }); break;
        case 'review':
          if (!c.allowedPeers.includes(store.read().entries.find(x => x.id === b.id)?.peer)) throw Error('词条不存在或会话未开放');
          result = store.review(b.id, b); break;
        case 'learn':
          if (!c.allowedPeers.includes(b.peer)) throw Error('该会话未开放');
          result = await learner.tick({ peer: b.peer, minutes: b.minutes, manual: true }); break;
        case 'reset-cursor':
          if (learner.busy) throw Error('请等当前整理完成再重新定位');
          if (!c.allowedPeers.includes(b.peer)) throw Error('该会话未开放');
          store.reset(b.peer, new NapcatSource(c.napcatDb).baseline(b.peer)); result = { reset: true }; break;
        case 'export': result = { schema: 1, entries: store.read().entries.filter(x => c.allowedPeers.includes(x.peer)) }; break;
        default: throw Error('未知管理操作');
      }
      send(res, 200, { ok: true, result });
    } catch (e) { send(res, 400, { ok: false, error: e.message }); }
  };
}
