import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {atomicJson} from './settings.js';import {OVERLAP_MS} from './source.js';
export const normalize=s=>String(s).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
export const text=(v,max,field)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`Invalid ${field}`);return v.trim()};
const categories=new Set(['build','weapon','armor','perk','quest','event','crafting','mechanic','bug','route','slang','other']);
export function validateCandidate(v,messages){
 if(!v||typeof v!=='object')throw Error('Invalid candidate');
 const c={title:text(v.title,100,'title'),body:text(v.body,1800,'body'),category:v.category||'other',platform:String(v.platform||'unknown').slice(0,40),version:String(v.version||'unknown').slice(0,60),tags:[],evidence:[]};
 if(!categories.has(c.category))throw Error('Invalid category');
 if(!Array.isArray(v.tags??[]))throw Error('Invalid tags');c.tags=[...new Set((v.tags||[]).slice(0,12).map(x=>text(x,40,'tag')))];
 if(!Array.isArray(v.evidence)||v.evidence.length<1||v.evidence.length>8)throw Error('Evidence is required');
 for(const e of v.evidence){const source=messages.find(m=>String(m.msg_id)===String(e.messageId));if(!source)throw Error('Evidence message is outside this batch');const quote=text(e.quote,320,'quote');if(!normalize(source.content).includes(normalize(quote))||normalize(quote).length<4)throw Error('Evidence quote does not match the actual message');c.evidence.push({messageId:String(source.msg_id),time:Number(source.time),quote});}
 return c;
}
const empty=()=>({schema:1,entries:[],cursors:{},budget:{day:'',used:0},events:[]});
function key(c){return [c.title,c.platform,c.version].map(normalize).join('|')}
export class KnowledgeStore {
 constructor(dir){this.dir=path.resolve(dir);this.file=path.join(this.dir,'knowledge.json');this.lock=path.join(this.dir,'.write-lock');}
 read(){if(!fs.existsSync(this.file))return empty();const s=JSON.parse(fs.readFileSync(this.file,'utf8'));if(s.schema!==1||!Array.isArray(s.entries)||!s.cursors||!s.budget)throw Error('Invalid knowledge store; original file preserved');return s;}
 transaction(fn){fs.mkdirSync(this.dir,{recursive:true});try{fs.mkdirSync(this.lock)}catch(e){if(e.code==='EEXIST')throw Error('Knowledge store is busy or has an interrupted write; inspect .write-lock before retrying');throw e}try{fs.writeFileSync(path.join(this.lock,'owner.json'),JSON.stringify({pid:process.pid,time:Date.now()}));const s=this.read();const out=fn(s);s.events=s.events.slice(-500);atomicJson(this.file,s);return out}finally{fs.rmSync(this.lock,{recursive:true,force:true})}}
 importStarter(peer,pack){
  if(!/^(group|user)_\d{5,14}$/.test(peer))throw Error('Invalid target peer');
  const missing=s=>pack.entries.filter(c=>!s.entries.some(x=>x.peer===peer&&x.seedId===`${pack.id}:${c.id}`));
  if(!missing(this.read()).length)return {added:0};
  return this.transaction(s=>{const rows=missing(s);if(s.entries.length+rows.length>5000)throw Error('Starter import exceeds knowledge capacity');
   for(const c of rows){const now=Date.now(),checkedAt=Math.min(...c.sources.map(x=>Date.parse(x.checkedAt+'T00:00:00Z')));
    const entry={...structuredClone(c),id:randomUUID(),peer,key:key(c),seedId:`${pack.id}:${c.id}`,seedRevision:pack.revision,origin:'starter',evidence:[],createdAt:now,updatedAt:checkedAt,lastSeen:checkedAt,conflicts:[],revisions:[]};
    const conflicts=s.entries.filter(x=>x.peer===peer&&x.key===entry.key&&x.status!=='retired'&&normalize(x.body)!==normalize(entry.body));
    if(conflicts.length){entry.status='disputed';entry.conflicts=conflicts.map(x=>x.id);for(const old of conflicts){old.revisions.push({at:now,status:old.status,body:old.body,reason:'Starter reference differs from existing entry'});old.revisions=old.revisions.slice(-20);old.status='disputed';old.conflicts=[...new Set([...old.conflicts,entry.id])];old.updatedAt=now;}}
    s.entries.push(entry);
   }
   s.events.push({at:Date.now(),kind:'starter-import',peer,revision:pack.revision,count:rows.length});return {added:rows.length};
  });
 }
 cursor(peer){return this.read().cursors[peer]}
 initialize(peer,position){return this.transaction(s=>{if(!s.cursors[peer])s.cursors[peer]={...position,lastAttempt:0,lastSuccess:0,error:''}})}
 reset(peer,position){return this.transaction(s=>{s.cursors[peer]={...position,lastAttempt:0,lastSuccess:0,error:''};s.events.push({at:Date.now(),peer,kind:'reset-cursor'})})}
 reserve(peer,limit,now=Date.now()) {return this.transaction(s=>{const day=new Date(now).toISOString().slice(0,10);if(s.budget.day!==day)s.budget={day,used:0};if(s.budget.used>=limit)return false;s.budget.used++;s.cursors[peer]={...(s.cursors[peer]||{time:0,seen:[]}),lastAttempt:now};return true})}
 fail(peer,error){this.transaction(s=>{s.cursors[peer]={...(s.cursors[peer]||{time:0,seen:[]}),lastAttempt:Date.now(),error:String(error).slice(0,400)}})}
 commit(peer,candidates,messages,{advance=true,now=Date.now()}={}){
  const clean=candidates.map(c=>validateCandidate(c,messages));
  return this.transaction(s=>{const changed=[];
   for(const c of clean){const k=key(c),duplicate=s.entries.find(x=>x.peer===peer&&x.key===k&&normalize(x.body)===normalize(c.body)&&x.status!=='retired');
    if(duplicate){const seen=new Set(duplicate.evidence.map(x=>x.messageId));for(const e of c.evidence)if(!seen.has(e.messageId)){duplicate.evidence.push(e);seen.add(e.messageId)}duplicate.evidence=duplicate.evidence.slice(-30);duplicate.lastSeen=now;changed.push(duplicate.id);continue}
    if(s.entries.length>=5000)throw Error('Knowledge capacity reached (5000 entries); archive or review first');
    const conflicts=s.entries.filter(x=>x.peer===peer&&x.key===k&&x.status!=='retired');
    const id=randomUUID(),entry={id,peer,key:k,...c,status:conflicts.length?'disputed':'experience',createdAt:now,updatedAt:now,lastSeen:now,conflicts:conflicts.map(x=>x.id),revisions:[]};
    for(const old of conflicts){old.revisions.push({at:now,status:old.status,body:old.body,reason:'Conflicting chat evidence'});old.revisions=old.revisions.slice(-20);old.status='disputed';old.conflicts=[...new Set([...old.conflicts,id])];old.updatedAt=now}
    s.entries.push(entry);changed.push(id);
   }
   if(advance){const old=s.cursors[peer]||{time:0,seen:[]},time=Math.max(old.time,...messages.map(m=>m.time));const seen=new Map([...(old.seen||[]),...messages.map(m=>[String(m.msg_id),m.time])]);s.cursors[peer]={...old,time,seen:[...seen].filter(x=>x[1]>=time-OVERLAP_MS),lastSuccess:now,error:''}}
   s.events.push({at:now,peer,kind:'learn',count:changed.length,ids:changed});return changed;
  });
 }
 review(id,{status,note,body}){if(!['verified','reference','experience','disputed','retired'].includes(status))throw Error('Invalid status');note=text(note,600,'review note');if(body!==undefined)body=text(body,1800,'body');return this.transaction(s=>{const x=s.entries.find(e=>e.id===id);if(!x)throw Error('Entry not found');x.revisions.push({at:Date.now(),status:x.status,body:x.body,reason:note});x.revisions=x.revisions.slice(-20);x.status=status;if(body)x.body=body;x.reviewNote=note;x.updatedAt=Date.now();s.events.push({at:x.updatedAt,peer:x.peer,kind:'review',id});return x})}
 search(peer,query,{limit=5,includeRetired=false,reviewAfterDays=120}={}){
  const q=normalize(query),terms=new Set();for(let i=0;i<q.length-1;i++)terms.add(q.slice(i,i+2));
  return this.read().entries.filter(x=>x.peer===peer&&(includeRetired||x.status!=='retired')).map(x=>{const title=normalize(x.title),tags=normalize(x.tags.join(' ')),body=normalize(x.body);let score=q?0:1;if(q&&(title.includes(q)||q.includes(title)))score+=30;for(const t of terms){if(title.includes(t))score+=4;if(tags.includes(t))score+=2;if(body.includes(t))score+=.5}return {...x,score,needsReview:Date.now()-(x.sources?.length?Math.min(x.updatedAt,...x.sources.map(s=>Date.parse(s.checkedAt+'T00:00:00Z'))):x.updatedAt)>(x.reviewAfterDays||reviewAfterDays)*86400000}}).filter(x=>x.score>= (q?2:1)).sort((a,b)=>b.score-a.score||b.updatedAt-a.updatedAt).slice(0,Math.max(1,Math.min(limit,200)));
 }
}
