import {judgeMuseEnabled} from '../../src/engine/judge-muse.ts';
/** Public schedule only. The existing judge flag remains the server's kill switch. */
export function judgeOpenAccess(env:{JUDGE_MUSE_MODE?:string;JUDGE_OPEN_UNTIL?:string},now=Date.now()):{open:boolean;until:number|null}{
 const raw=env.JUDGE_OPEN_UNTIL;
 const ms=raw&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)?Date.parse(raw):NaN;
 const until=Number.isFinite(ms)&&new Date(ms).toISOString()===(raw!.includes('.')?raw:raw!.replace('Z','.000Z'))?ms:null;
 return {open:judgeMuseEnabled(env.JUDGE_MUSE_MODE)&&until!==null&&now<until,until};
}
export const judgeAccessEnded=()=>new Response(JSON.stringify({error:'judge_access_ended',message:'Judge access has ended — watching is open to everyone.'}),{status:403,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
