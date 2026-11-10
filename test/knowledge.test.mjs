import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Settings } from '../lib/settings.js';
import { KnowledgeStore } from '../lib/store.js';
import { NapcatSource } from '../lib/source.js';
import { Learner, parseExtraction } from '../lib/learner.js';
import { searchForSession, makePreStep } from '../lib/runtime.js';
import { createHandler } from '../lib/http.js';
import { starterCatalog, ensureStarter } from '../lib/starter.js';
import { peerOf, knowledgeContext } from '../lib/context.js';
const GROUP = 'group_123456789', PRIVATE = 'user_987654321';
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fo76-test-'));
  const settings = new Settings(home); settings.save({ allowedPeers: [GROUP], minMessages: 1, intervalSeconds: 30 });
  const c = settings.read(); fs.mkdirSync(path.dirname(c.napcatDb), { recursive: true });
  const db = new DatabaseSync(c.napcatDb);
  db.exec('CREATE TABLE messages (msg_id INTEGER PRIMARY KEY,peer TEXT,time INTEGER,content TEXT,self INTEGER DEFAULT 0,recalled INTEGER DEFAULT 0,source TEXT DEFAULT \'qq\')');
  t.after(() => { db.close(); fs.rmSync(home, { recursive: true, force: true }); });
  const insert = (id, content, { peer = GROUP, time = Date.now(), self = 0, recalled = 0, source = 'qq' } = {}) => db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(id, peer, time, content, self, recalled, source);
  return { settings, db, insert, store: new KnowledgeStore(c.dataDir), source: new NapcatSource(c.napcatDb) };
}
const candidate = (id, quote, overrides = {}) => ({ title: '测试武器的换弹条件', body: '测试群友称：测试武器需要先换弹再触发效果。', category: 'weapon', tags: ['测试武器', '换弹'], platform: 'PC', version: 'unknown', evidence: [{ messageId: String(id), quote }], ...overrides });
const message = (id = 1, content = '测试武器需要先换弹再触发效果') => ({ msg_id: id, time: Date.now(), content });

test('first run skips old history; later smaller/negative message IDs and slightly delayed messages are learned once', async t => {
  const f = fixture(t), old = Date.now() - 10000; let calls = 0;
  f.insert(999999, '旧消息不自动回看', { time: old });
  const learner = new Learner(f.settings, async batch => { calls++; return batch.map(x => candidate(x.msg_id, x.content)); });
  assert.equal((await learner.tick()).results[0].initialized, true); assert.equal(calls, 0);
  f.insert(-8, '测试武器需要先换弹再触发效果', { time: old + 5000 });
  assert.equal((await learner.tick({ manual: true })).results[0].saved, 1);
  f.insert(-9, '测试武器需要先换弹再触发效果', { time: old + 4000 });
  assert.equal((await learner.tick({ manual: true })).results[0].saved, 1);
  await learner.tick({ manual: true }); assert.equal(calls, 2);
  assert.equal(f.store.read().entries.length, 1); assert.equal(f.store.read().entries[0].evidence.length, 2);
  const restarted = new Learner(f.settings, async () => { throw Error('must not repeat'); });
  assert.deepEqual((await restarted.tick({ manual: true })).results, []);
});

test('SQLite source excludes other peers, own replies, agent traffic and recalled messages', t => {
  const f = fixture(t); f.insert(1, '有效玩家讨论'); f.insert(2, '私聊隐私', { peer: PRIVATE });
  f.insert(3, '大肥鱼自己说的', { self: 1 }); f.insert(4, '内部agent说的', { source: 'agent' }); f.insert(5, '已撤回', { recalled: 1 });
  assert.deepEqual(f.source.batch(GROUP, { time: 0, seen: [] }, 60).map(x => x.msg_id), [1]);
  assert.deepEqual(f.source.recent(GROUP, 60, 60).map(x => x.msg_id), [1]);
});

test('invalid evidence cannot write any candidates or advance progress; retry succeeds', async t => {
  const f = fixture(t); let valid = false;
  const learner = new Learner(f.settings, async batch => [candidate(batch[0].msg_id, valid ? batch[0].content : '模型编造的原话')]);
  await learner.tick(); f.insert(42, '测试武器需要先换弹再触发效果');
  const before = f.store.cursor(GROUP).time;
  assert.match((await learner.tick({ manual: true })).results[0].error, /quote/);
  assert.equal(f.store.read().entries.length, 0); assert.equal(f.store.cursor(GROUP).time, before);
  valid = true; assert.equal((await learner.tick({ manual: true })).results[0].saved, 1);
  assert.equal(f.store.read().budget.used, 2);
});

test('empty model selection still advances; malformed model JSON does not', async t => {
  const f = fixture(t), learner = new Learner(f.settings, async () => []);
  await learner.tick(); f.insert(1, '大家晚上好呀');
  assert.equal((await learner.tick({ manual: true })).results[0].saved, 0);
  assert.deepEqual((await learner.tick({ manual: true })).results, []);
  assert.throws(() => parseExtraction('不是JSON')); assert.throws(() => parseExtraction('{"entries":[1,2,3,4,5]}'));
  assert.deepEqual(parseExtraction('```json\n{"entries":[]}\n```'), []);
});

test('dedupe, conflict preservation, correction history and retired exclusion survive disk reload', t => {
  const f = fixture(t), m = message();
  f.store.commit(GROUP, [candidate(1, m.content)], [m]);
  f.store.commit(GROUP, [candidate(1, m.content)], [m]); assert.equal(f.store.read().entries.length, 1);
  const m2 = message(2, '测试武器不需要换弹，效果就能触发');
  f.store.commit(GROUP, [candidate(2, m2.content, { body: '测试群友称无需换弹。' })], [m2]);
  const entries = f.store.read().entries; assert.equal(entries.length, 2); assert.ok(entries.every(x => x.status === 'disputed'));
  f.store.review(entries[0].id, { status: 'retired', note: '测试淘汰错误说法' });
  const reload = new KnowledgeStore(f.settings.read().dataDir);
  assert.equal(reload.search(GROUP, '测试武器').length, 1); assert.equal(reload.read().entries[0].revisions.length, 2);
  assert.throws(() => reload.review(entries[1].id, { status: 'verified', note: '' }));
});

test('retrieval and context stay scoped; old context is replaced and no-hit does not inject', async t => {
  const f = fixture(t), m = message(); f.settings.save({ allowedPeers: [GROUP, PRIVATE] });
  f.store.commit(PRIVATE, [candidate(1, m.content, { body: '私聊秘密测试词条' })], [m]);
  const context = { agent: { session: { id: 'qq-group-123456789-r2-123456' } } };
  assert.deepEqual(searchForSession(f.settings, context, '测试武器').filter(x=>x.origin!=='starter'), []);
  f.store.commit(GROUP, [candidate(1, m.content)], [m]);
  assert.equal(searchForSession(f.settings, context, '测试武器').filter(x=>x.origin!=='starter').length, 1);
  assert.deepEqual(searchForSession(f.settings, { agent: { session: { id: 'web-123' } } }, '测试武器'), []);
  assert.equal(peerOf({ sessionId: 'qq-group-1234567890x' }), null);
  const hook = makePreStep(f.settings, m => ({ ...m, role: 'user' }));
  const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '测试武器怎么换弹' }] }];
  const noHit = await hook({ ...context, messages: [{role:'user', content:[{type:'text',text:'zqxjkvxyz'}]}] }); assert.equal(noHit.messages.length,1);
  const result = await hook({ ...context, messages });
  assert.equal(result.messages.length, 2); assert.ok(!JSON.stringify(result).includes('私聊秘密'));
  assert.equal((await hook({ ...context, messages: result.messages })).messages.length, 2);
  f.settings.save({ enabled: false }); assert.equal((await hook({ ...context, messages: result.messages })).messages.length, 1);
});

test('daily request limit persists across restarts and disabled learning never calls model', async t => {
  const f = fixture(t); f.settings.save({ dailyBatches: 1 });
  const learner = new Learner(f.settings, async () => []); await learner.tick(); f.insert(1, '今天测试游戏机制');
  await learner.tick({ manual: true }); f.insert(2, '继续测试游戏机制');
  const restarted = new Learner(f.settings, async () => { throw Error('must not call'); });
  assert.equal((await restarted.tick({ manual: true })).results[0].skipped, 'daily-limit');
  f.settings.save({ autoLearn: false }); assert.equal((await restarted.tick()).skipped, 'disabled');
  f.settings.save({ enabled: false }); assert.equal((await restarted.tick({ manual: true })).skipped, 'disabled');
});

test('manual historical collection establishes current baseline and does not replay all old history', async t => {
  const f = fixture(t); f.insert(1, '远古消息不要自动回看', { time: Date.now() - 3600000 }); f.insert(2, '测试武器需要先换弹再触发效果');
  const learner = new Learner(f.settings, async batch => batch.map(x => candidate(x.msg_id, x.content)));
  assert.equal((await learner.tick({ peer: GROUP, minutes: 5, manual: true })).results[0].read, 1);
  assert.deepEqual((await learner.tick({ manual: true })).results, []);
});

test('in-flight disable discards extraction; concurrent learning is rejected', async t => {
  const f = fixture(t); let resolve;
  const learner = new Learner(f.settings, () => new Promise(r => { resolve = r; }));
  await learner.tick(); f.insert(1, '测试武器需要先换弹再触发效果');
  const pending = learner.tick({ manual: true });
  assert.equal((await learner.tick()).skipped, 'busy');
  f.settings.save({ enabled: false }); resolve([candidate(1, '测试武器需要先换弹再触发效果')]);
  assert.match((await pending).results[0].error, /取消/); assert.equal(f.store.read().entries.length, 0);
});

test('corrupt file and another writer lock are preserved, not silently replaced', t => {
  const f = fixture(t); fs.mkdirSync(f.store.dir, { recursive: true }); fs.writeFileSync(f.store.file, '{broken');
  assert.throws(() => f.store.initialize(GROUP, { time: 0, seen: [] })); assert.equal(fs.readFileSync(f.store.file, 'utf8'), '{broken');
  fs.mkdirSync(f.store.lock); fs.writeFileSync(path.join(f.store.lock, 'marker'), 'other writer');
  assert.throws(() => f.store.initialize(GROUP, { time: 0, seen: [] }), /busy/); assert.ok(fs.existsSync(path.join(f.store.lock, 'marker')));
});

test('HTTP management authenticates reads and mutations, rejects CSRF and scopes operations', async t => {
  const f = fixture(t), learner = new Learner(f.settings, async () => []);
  const handler = createHandler({ settings: f.settings, learner, authenticate: req => req.headers.authorization === 'local-test' ? undefined : 401 });
  const server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 401);
  const headers = { authorization: 'local-test', 'content-type': 'application/json', origin: base };
  assert.equal((await fetch(base, { headers })).status, 200);
  assert.equal((await fetch(base, { method: 'POST', headers: { ...headers, origin: 'https://evil.invalid' }, body: '{"action":"export"}' })).status, 403);
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ action: 'search', peer: PRIVATE }) })).status, 400);
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ action: 'configure', config: { enabled: false } }) })).status, 200);
  assert.equal(f.settings.read().enabled, false);
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ action: 'search', peer: GROUP, query: 'x'.repeat(66000) }) })).status, 400);
});

test('a model that ignores abort still times out without recording or advancing', async t => {
  const f = fixture(t), learner = new Learner(f.settings, () => new Promise(() => {}), { timeoutMs: 20 });
  await learner.tick(); f.insert(1, '测试武器需要先换弹再触发效果');
  const result = await learner.tick({ manual: true });
  assert.match(result.results[0].error, /时间限制/); assert.equal(learner.busy, false);
  assert.equal(f.store.read().entries.length, 0); assert.equal(f.store.cursor(GROUP).time, 0);
});

test('missing source database reports failure and does not invent a successful learning run', async t => {
  const f = fixture(t); f.settings.save({ napcatDb: path.join(f.settings.home, 'absent.sqlite') });
  const learner = new Learner(f.settings, async () => { throw Error('must not call'); });
  await assert.rejects(learner.tick(), /尚不存在/); assert.equal(learner.busy, false); assert.match(learner.lastError, /尚不存在/);
});

test('public defaults do not read or learn any conversation until explicitly configured', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fo76-empty-defaults-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const settings = new Settings(home); assert.deepEqual(settings.read().allowedPeers, []);
  const learner = new Learner(settings, async () => { throw Error('No conversation authorized'); });
  assert.deepEqual(await learner.tick(), { results: [] });
  assert.equal(fs.existsSync(path.join(settings.read().dataDir, 'knowledge.json')), false);
  assert.deepEqual(searchForSession(settings, { sessionId: 'qq-group-123456789' }, '测试武器'), []);
});

test('starter catalog includes attributed official, wiki and community records without fabricated chat evidence', () => {
  const pack = starterCatalog(); assert.equal(pack.entries.length, 77);
  const kinds = new Set(pack.entries.flatMap(x=>x.sources.map(s=>s.kind)));
  assert.deepEqual([...kinds].sort(), ['community','official','wiki']);
  for(const entry of pack.entries) { assert.ok(entry.sources.every(s=>s.url.startsWith('https://') && s.checkedAt)); assert.notEqual(entry.status,'verified'); }
});

test('starter retrieval works with no NapCat database; sources reach context', async t => {
  const f=fixture(t);f.settings.save({napcatDb:path.join(f.settings.home,'not-installed.sqlite')});
  const ctx={sessionId:'qq-group-123456789'};
  const entries=searchForSession(f.settings,ctx,'打卡机'); assert.ok(entries.some(x=>x.seedId.endsWith(':loadouts')));
  const hook=makePreStep(f.settings,m=>({...m,role:'user'}));
  const result=await hook({...ctx,messages:[{role:'user',content:[{type:'text',text:'怎么用打卡机洗点'}]}]});
  assert.ok(JSON.stringify(result).includes('help.bethesda.net')); assert.ok(JSON.stringify(result).includes('reference'));
  assert.equal(f.store.read().entries.length,starterCatalog().entries.length); assert.deepEqual(f.store.read().cursors,{});
});

test('starter import preserves old chat data, cursors and budget and is idempotent after edits or retirement', t => {
  const f=fixture(t),m=message();f.store.initialize(GROUP,{time:99,seen:[['old',99]]});f.store.reserve(GROUP,48);
  f.store.commit(GROUP,[candidate(m.msg_id,m.content)],[m],{advance:false});
  const old=f.store.read();assert.equal(ensureStarter(f.settings.read()).added,starterCatalog().entries.length);
  const seeded=f.store.read().entries.find(x=>x.origin==='starter');f.store.review(seeded.id,{status:'retired',body:'管理员保留的修订内容',note:'旧攻略停用'});
  assert.equal(ensureStarter(f.settings.read()).added,0);
  const now=f.store.read();assert.deepEqual(now.cursors,old.cursors);assert.deepEqual(now.budget,old.budget);assert.equal(now.entries.length,starterCatalog().entries.length+1);
  assert.equal(now.entries.find(x=>x.id===seeded.id).body,'管理员保留的修订内容');assert.equal(now.entries.find(x=>x.id===seeded.id).status,'retired');
});

test('group corrections to starter entries stay in that group and preserve website provenance', t => {
  const f=fixture(t);f.settings.save({allowedPeers:[GROUP,PRIVATE]});ensureStarter(f.settings.read());
  const seed=f.store.read().entries.find(x=>x.peer===GROUP&&x.seedId.endsWith(':loadouts'));
  const m=message(123,'这是假设用于测试的不同版本配点经验');
  f.store.commit(GROUP,[candidate(m.msg_id,m.content,{title:seed.title,body:m.content,platform:seed.platform,version:seed.version})],[m]);
  const updated=f.store.read();assert.equal(updated.entries.find(x=>x.id===seed.id).status,'disputed');
  assert.equal(updated.entries.find(x=>x.id===seed.id).sources[0].url,seed.sources[0].url);
  assert.equal(updated.entries.find(x=>x.peer===PRIVATE&&x.seedId===seed.seedId).status,'reference');
});

test('disabled plugin does not populate starter and locked store refuses partial import', t => {
  const f=fixture(t);f.settings.save({enabled:false});assert.equal(ensureStarter(f.settings.read()).added,0);assert.equal(f.store.read().entries.length,0);
  f.settings.save({enabled:true});fs.mkdirSync(f.store.lock,{recursive:true});
  assert.throws(()=>ensureStarter(f.settings.read()),/busy/);assert.equal(f.store.read().entries.length,0);
});

test('source review date and per-entry expiry are respected even after a new import', t => {
  const f=fixture(t),pack=structuredClone(starterCatalog());pack.entries=[pack.entries[0]];pack.entries[0].sources[0].checkedAt='2020-01-01';
  f.store.importStarter(GROUP,pack);const entry=f.store.search(GROUP,'存垃圾')[0];assert.equal(entry.needsReview,true);
});


test('v0.2.0 upgrade adds 41 records without replacing corrected or retired entries or learning progress', t => {
  const f = fixture(t), pack = starterCatalog();
  const oldPack = { ...pack, revision: '2026-11-10.1', entries: pack.entries.filter(e => !e.id.startsWith('exp-')) };
  assert.equal(oldPack.entries.length, 36);
  f.store.importStarter(GROUP, oldPack);
  const oldEntry = f.store.read().entries[0];
  f.store.review(oldEntry.id, { status: 'retired', body: '管理员此前修订，请保留', note: '升级保留测试' });
  f.store.initialize(GROUP, { time: 12345, seen: [['abc', 12345]] }); f.store.reserve(GROUP, 48);
  const before = f.store.read();
  assert.equal(ensureStarter(f.settings.read()).added, 41);
  const after = f.store.read();
  assert.equal(after.entries.length, 77);
  assert.deepEqual(after.entries.find(e => e.id === oldEntry.id), before.entries.find(e => e.id === oldEntry.id));
  assert.deepEqual(after.cursors, before.cursors); assert.deepEqual(after.budget, before.budget);
  assert.equal(ensureStarter(f.settings.read()).added, 0);
});

test('all eight expanded build bodies and bounded citations reach context without losing stored provenance', t => {
  const f = fixture(t); ensureStarter(f.settings.read());
  const builds = f.store.read().entries.filter(e => e.buildDetails);
  assert.equal(builds.length, 8);
  for (const entry of builds) {
    assert.equal(entry.status, 'experience'); assert.equal(entry.verification.liveTested, false);
    const before = structuredClone(entry), context = knowledgeContext([entry]);
    assert.ok(context.length > 0 && context.length <= 4500);
    const row = JSON.parse(context.split('\n')[1]);
    assert.equal(row.body, entry.body); assert.equal(row.liveTested, false);
    assert.equal(row.sourceCount, entry.sources.length); assert.ok(row.sources.length <= 3);
    assert.deepEqual(entry, before);
    assert.ok(f.store.search(GROUP, entry.title).some(e => e.id === entry.id));
  }
});

test('oversized first context record does not suppress a later fitting result', () => {
  const row = { id: 'short', title: '短条目', body: '可容纳的游戏机制', lastSeen: Date.now(), sources: [], evidence: [] };
  const context = knowledgeContext([{ ...row, id: 'large', body: 'x'.repeat(5000) }, row], 700);
  assert.ok(context.length <= 700); assert.match(context, /可容纳的游戏机制/); assert.ok(!context.includes('"large"'));
  assert.equal(knowledgeContext([row], 10), '');
});

test('research source mappings resolve and eight dated snapshots stay out of the runtime catalog', () => {
  const research = new URL('../docs/research/2026-11-10-expanded/', import.meta.url);
  const candidates = JSON.parse(fs.readFileSync(new URL('knowledge-candidates.json', research), 'utf8')).entries;
  const sources = JSON.parse(fs.readFileSync(new URL('sources.json', research), 'utf8')).sources;
  const sourceIds = new Set(sources.map(s => s.id));
  const catalogIds = new Set(starterCatalog().entries.map(e => e.id));
  assert.equal(candidates.length, 49);
  const snapshots = candidates.filter(e => !e.handoff.starterReviewEligible); assert.equal(snapshots.length, 8);
  for (const e of candidates) {
    for (const id of [...e.verification.sourceIds, ...e.verification.supplementalSourceIds]) assert.ok(sourceIds.has(id), id);
    assert.equal(catalogIds.has(e.id), e.handoff.starterReviewEligible);
  }
  for (const e of starterCatalog().entries) {
    assert.notEqual(e.classification, 'time-limited'); assert.ok(!('validFrom' in e) && !('validUntil' in e));
  }
});
