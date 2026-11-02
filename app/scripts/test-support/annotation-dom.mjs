// Tiny DOM for serialized annotation tests; this never opens a browser or proves optical readability.
import {Script} from 'node:vm';
export function annotationDom(){
 let node,top;const sandbox={window:{innerWidth:1920,innerHeight:960},document:{createElement(tag){if(tag==='style')return{textContent:'',remove(){}};return node={style:{},isConnected:false,textContent:'',showPopover(){top=this;},remove(){this.isConnected=false;},getBoundingClientRect:()=>({left:12,top:8,right:1908,bottom:68,width:1896,height:60})};},elementsFromPoint:()=>[top],body:{append(n){n.isConnected=true;}}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),MutationObserver:class{observe(){}disconnect(){}},setInterval(){return 1;},clearInterval(){}};
 return{evaluate(fn,arg){if(!['installControlledLabel','readControlledLabel'].includes(fn.name))return;return new Script('('+fn.toString()+')('+(arg===undefined?'':JSON.stringify(arg))+')').runInNewContext(sandbox);},occlude(){top={name:'blocking top layer'};}};
}
