/** One private SQLite row for the world's model-key policy. No secret values are stored. */
type Sql={exec:(query:string,...bindings:unknown[])=>{toArray:()=>unknown[]}};
export type ModelKeyChoice={key:'primary'|'fallback';fingerprint:string;epoch:number;probe:string|null};
export type ModelKeyOutcome='success'|'exhausted'|'other';
export type ModelKeyPolicy={select:()=>ModelKeyChoice|Promise<ModelKeyChoice>;settle:(choice:ModelKeyChoice,outcome:ModelKeyOutcome)=>void|Promise<void>};
type State={key:'primary'|'fallback';changedAt:number|null;nextRetryAt:number|null;retries:number;pinned:boolean;epoch:number;probe:string|null};
export class ModelKeyState implements ModelKeyPolicy{
 private fingerprint='';private hasFallback=false;private sql:Sql;private now:()=>number;
 constructor(sql:Sql,now:()=>number=Date.now){this.sql=sql;this.now=now;sql.exec('CREATE TABLE IF NOT EXISTS model_key_policy (id INTEGER PRIMARY KEY CHECK(id=1), key_fingerprint TEXT NOT NULL, state_json TEXT NOT NULL)');}
 async init(primary?:string,fallback?:string){
  this.hasFallback=!!primary&&!!fallback&&primary!==fallback;
  this.fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([primary??null,fallback??null]))))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const row=this.sql.exec('SELECT key_fingerprint,state_json FROM model_key_policy WHERE id=1').toArray()[0] as {key_fingerprint:string;state_json:string}|undefined;
  if(!row||row.key_fingerprint!==this.fingerprint)this.save({key:'primary',changedAt:null,nextRetryAt:null,retries:0,pinned:false,epoch:0,probe:null});
 }
 private read():State{const row=this.sql.exec('SELECT key_fingerprint,state_json FROM model_key_policy WHERE id=1').toArray()[0] as {key_fingerprint:string;state_json:string}|undefined;if(!this.fingerprint||row?.key_fingerprint!==this.fingerprint)throw Error('model_key_configuration_changed');return JSON.parse(row.state_json);}
 private save(state:State){this.sql.exec('INSERT INTO model_key_policy (id,key_fingerprint,state_json) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET key_fingerprint=excluded.key_fingerprint,state_json=excluded.state_json',this.fingerprint,JSON.stringify(state));}
 status(){const s=this.read();return{modelKey:s.key,modelKeyChangedAt:s.changedAt,modelKeyPrimaryRetries:s.retries,modelKeyPinned:s.pinned};}
 select():ModelKeyChoice{
  const s=this.read();let key=s.key,probe:string|null=null;
  if(s.key==='fallback'&&!s.pinned&&s.nextRetryAt!==null&&this.now()>=s.nextRetryAt){
   // Persist the hourly lease before external I/O, including across isolate restart.
   key='primary';probe=crypto.randomUUID();s.probe=probe;s.epoch++;s.nextRetryAt=this.now()+3600000;this.save(s);
  }
  return{key,fingerprint:this.fingerprint,epoch:s.epoch,probe};
 }
 settle(choice:ModelKeyChoice,outcome:ModelKeyOutcome){
  const s=this.read();if(choice.fingerprint!==this.fingerprint||choice.epoch!==s.epoch||choice.key!=='primary')return;
  if(choice.probe!==s.probe)return;
  if(outcome==='success'&&s.key==='fallback'){
   this.save({key:'primary',changedAt:this.now(),nextRetryAt:null,retries:0,pinned:false,epoch:s.epoch+1,probe:null});
  }else if(outcome==='exhausted'&&this.hasFallback){
   if(s.key==='primary'){s.key='fallback';s.changedAt=this.now();s.retries=0;}
   else if(choice.probe)s.retries=Math.min(3,s.retries+1);
   s.pinned=s.retries>=3;s.nextRetryAt=s.pinned?null:this.now()+3600000;s.probe=null;s.epoch++;this.save(s);
  }else if(choice.probe){s.probe=null;s.epoch++;this.save(s);}
 }
}
