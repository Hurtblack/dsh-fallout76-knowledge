import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
export const OVERLAP_MS = 120000;
const HUMAN = "self=0 AND COALESCE(recalled,0)=0 AND COALESCE(source,'qq')='qq' AND length(content)>0";
export class NapcatSource {
  constructor(file) { this.file = file; }
  using(fn) {
    if (!fs.existsSync(this.file)) throw Error('NapCat消息库尚不存在，等待QQ接入完成');
    const db = new DatabaseSync(this.file, { readOnly: true });
    try { db.exec('PRAGMA busy_timeout=1000'); return fn(db); } finally { db.close(); }
  }
  baseline(peer) {
    return this.using(db => {
      const time = Number(db.prepare('SELECT COALESCE(MAX(time),0) AS n FROM messages WHERE peer=?').get(peer).n);
      const seen = db.prepare('SELECT msg_id,time FROM messages WHERE peer=? AND time>=?').all(peer, time - OVERLAP_MS).map(x => [String(x.msg_id), x.time]);
      return { time, seen };
    });
  }
  batch(peer, cursor, limit) {
    return this.using(db => {
      const seen = new Set((cursor.seen || []).map(x => x[0])), result = [];
      // msg_id is SQLite's rowid in the bridge and is NOT an insertion sequence.
      for (const x of db.prepare(`SELECT msg_id,time,content FROM messages WHERE peer=? AND time>=? AND ${HUMAN} ORDER BY time,msg_id`).iterate(peer, cursor.time - OVERLAP_MS)) {
        if (seen.has(String(x.msg_id))) continue;
        result.push({ ...x, content: String(x.content).slice(0, 1800) });
        if (result.length >= limit) break;
      }
      return result;
    });
  }
  recent(peer, minutes, limit) {
    return this.using(db => db.prepare(`SELECT msg_id,time,content FROM messages WHERE peer=? AND time>=? AND ${HUMAN} ORDER BY time DESC,msg_id DESC LIMIT ?`).all(peer, Date.now() - minutes * 60000, limit).reverse().map(x => ({ ...x, content: String(x.content).slice(0, 1800) })));
  }
}
