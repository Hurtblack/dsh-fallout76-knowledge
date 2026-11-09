import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export const dshHome=()=>path.resolve(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'));
export function defaults(home=dshHome()){return {enabled:true,autoLearn:true,allowedPeers:[],dataDir:path.join(home,'fallout76-knowledge'),napcatDb:path.join(home,'napcat','messages.sqlite'),provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'low',intervalSeconds:300,minMessages:6,idleSeconds:300,batchSize:60,dailyBatches:48,contextChars:4500,reviewAfterDays:120};}
const int=(v,lo,hi)=>{if(!Number.isInteger(v)||v<lo||v>hi)throw Error(`Expected integer ${lo}..${hi}`);return v};
export function validateSettings(input,home=dshHome()){
 const x={...defaults(home),...input};
 for(const k of ['enabled','autoLearn'])if(typeof x[k]!=='boolean')throw Error(`${k} must be boolean`);
 if(!Array.isArray(x.allowedPeers)||x.allowedPeers.length>20||x.allowedPeers.some(p=>! /^(group|user)_\d{5,14}$/.test(p)))throw Error('allowedPeers must contain explicit QQ group/user peers');
 x.allowedPeers=[...new Set(x.allowedPeers)];for(const k of ['dataDir','napcatDb']){if(typeof x[k]!=='string'||!path.isAbsolute(x[k]))throw Error(`${k} must be an absolute path`);x[k]=path.normalize(x[k]);}
 for(const k of ['provider','model','reasoningEffort'])if(typeof x[k]!=='string'||x[k].length>100)throw Error(`Invalid ${k}`);
 for(const [k,lo,hi] of [['intervalSeconds',30,3600],['minMessages',1,100],['idleSeconds',30,3600],['batchSize',1,120],['dailyBatches',1,288],['contextChars',500,12000],['reviewAfterDays',1,730]])x[k]=int(x[k],lo,hi);
 return Object.fromEntries(Object.keys(defaults(home)).map(k=>[k,x[k]]));
}
export class Settings {
 constructor(home=dshHome()){this.home=home;this.file=path.join(home,'fallout76-knowledge.json');}
 read(){return validateSettings(fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{},this.home);}
 save(patch){const x=validateSettings({...this.read(),...patch},this.home);atomicJson(this.file,x);return x;}
}
export function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+`.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temp,file)}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}}
