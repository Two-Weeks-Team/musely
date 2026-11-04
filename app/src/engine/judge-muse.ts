/** Fixed shared demo actor. This public catalog is never an authentication proof. */
export const JUDGE_MUSE=Object.freeze({id:'10-judge',name:'Judge Muse',appearanceId:'01-sunny',roleId:'01-sunny',label:'Judge account · provided by the team'} as const);
export function judgeMuseEnabled(mode:string|undefined):boolean {
 if(mode===undefined||mode===''||mode==='off')return false;
 if(mode!=='shared-v1')throw Error('unsupported_JUDGE_MUSE_MODE');
 return true;
}
