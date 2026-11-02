// External filming annotation only; these functions are serialized into an already authorized capture page.
export const controlledLabelFor=(p,v)=>({text:'REPLAY | CONTROLLED COMPARISON (SIMULATION) | '+v.id.toUpperCase()+' | VIRTUAL WORLD | LOCAL REPLAY | NO MODEL CALL | build '+p.release.sourceSha.slice(0,12),sourceSha:p.release.sourceSha,variant:v.id});
export function installControlledLabel(expected){
 const old=window.__d05ControlledLabel;if(old){old.observer.disconnect();clearInterval(old.timer);old.node.remove();old.sheet?.remove();}
 const node=document.createElement('div');node.id='d05-filming-provenance';node.popover='manual';node.textContent=expected.text;
 Object.assign(node.style,{position:'fixed',top:'8px',left:'12px',right:'12px',zIndex:'2147483647',padding:'10px 14px',background:'rgba(0,0,0,.9)',color:'#fff',font:'700 17px/1.4 system-ui',pointerEvents:'none',bottom:'auto',margin:'0',border:'0',maxWidth:'none',maxHeight:'none',overflow:'visible',boxSizing:'border-box',width:'auto',borderRadius:'6px',boxShadow:'none'});document.body.append(node);
 const sheet=document.createElement('style'),css='#d05-filming-provenance::backdrop{background:transparent!important;backdrop-filter:none!important;pointer-events:none!important}';sheet.textContent=css;document.body.append(sheet);
 let topLayer=false;try{node.showPopover();topLayer=true;}catch{}
 const state={...expected,node,sheet,valid:true,visible:false};
 // CSS/rect alone miss top-layer backdrops. Temporarily enable hit-testing, sample the full banner,
 // and retain any failure even if a later popover closes. This is a capture guard, not optical proof.
 state.check=()=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);let visible=topLayer&&sheet.isConnected&&sheet.textContent===css&&node.isConnected&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=window.innerWidth&&r.bottom<=window.innerHeight&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)===1;
  if(visible){const pointer=node.style.pointerEvents;state.observer.disconnect();node.style.pointerEvents='auto';try{if(typeof document.elementsFromPoint!=='function')visible=false;else for(let y=r.top+1;y<r.bottom;y+=Math.min(12,r.height/2))for(let x=r.left+1;x<r.right;x+=Math.min(24,r.width/2)){const hit=document.elementsFromPoint(x,y)[0];if(hit!==node&&!node.contains?.(hit))visible=false;}}catch{visible=false;}finally{node.style.pointerEvents=pointer;state.observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});}}
  state.visible=visible;state.valid=state.valid&&visible&&node.textContent===expected.text;};
 state.observer=new MutationObserver(state.check);state.observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});state.timer=setInterval(state.check,100);window.__d05ControlledLabel=state;state.check();
}
export function readControlledLabel(){const s=window.__d05ControlledLabel;if(!s)return null;s.check();return{valid:s.valid,visible:s.visible,text:s.node.textContent,sourceSha:s.sourceSha,variant:s.variant};}
