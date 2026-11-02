// External filming annotation only; these functions are serialized into an already authorized capture page.
export const controlledLabelFor=(p,v)=>({text:'REPLAY | CONTROLLED COMPARISON (SIMULATION) | '+v.id.toUpperCase()+' | VIRTUAL WORLD | LOCAL REPLAY | NO MODEL CALL | build '+p.release.sourceSha.slice(0,12),sourceSha:p.release.sourceSha,variant:v.id});
export function installControlledLabel(expected){
 const old=window.__d05ControlledLabel;if(old){old.observer.disconnect();clearInterval(old.timer);old.node.remove();}
 const node=document.createElement('div');node.id='d05-controlled-comparison';node.textContent=expected.text;
 Object.assign(node.style,{position:'fixed',top:'8px',left:'12px',right:'12px',zIndex:'2147483647',padding:'10px 14px',background:'rgba(0,0,0,.9)',color:'#fff',font:'700 17px/1.4 system-ui',pointerEvents:'none'});document.body.append(node);
 const state={...expected,node,valid:true,visible:false};
 state.check=()=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);state.visible=node.isConnected&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;state.valid=state.valid&&state.visible&&node.textContent===expected.text;};
 state.observer=new MutationObserver(state.check);state.observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});state.timer=setInterval(state.check,100);window.__d05ControlledLabel=state;state.check();
}
export function readControlledLabel(){const s=window.__d05ControlledLabel;if(!s)return null;s.check();return{valid:s.valid,visible:s.visible,text:s.node.textContent,sourceSha:s.sourceSha,variant:s.variant};}
