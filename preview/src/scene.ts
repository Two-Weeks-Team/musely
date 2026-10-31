import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {positionAt} from './activity';
import {conversationAt} from './story';
import {surfaceHeightAt} from './surfaces';
import {instanceMovingMeshes} from './instances';
import {mapMeshMaterials,paintMuseMaterial} from './materials';
export const PEOPLE=[
 {name:"Jimin's Muse",color:'#eab45c',accent:'#8b658f',role:'Your Muse',activity:'Finding a moment to meet'},
 {name:"Sora's Muse",color:'#ad9fd0',accent:'#f4d8a6',role:'A familiar face',activity:'A hello at the cafe'},
 {name:"Mina's Muse",color:'#85bfb1',accent:'#e79581',role:'Music & company',activity:'Listening by the fire'},
 {name:"Noa's Muse",color:'#db8d83',accent:'#f2db9c',role:'Garden friend',activity:'Tending the little garden'},
 {name:"Yuri's Muse",color:'#96b5d4',accent:'#eee4c9',role:'A quiet afternoon',activity:'Reading in the shade'},
 {name:"Ren's Muse",color:'#adbe7c',accent:'#ba826c',role:'A good neighbor',activity:'Sharing a slow morning'},
 {name:"Ari's Muse",color:'#d9b6ca',accent:'#7d9fa1',role:'Music & company',activity:'Keeping a seat for a friend'},
 {name:"Sol's Muse",color:'#caa486',accent:'#adc5b5',role:'A little adventure',activity:'Taking the long way home'},
];
const ENV={background:'#101623',ground:'#1B2436',path:'#2A3550',building:'#232E47',fire:'#FF9E45',core:'#FFD98A',cream:'#F2E9D8'};
const mat=(c:string)=>new T.MeshStandardMaterial({color:c,roughness:.96,metalness:0});
export async function makeWorld(glb:string,sigils:string[]){
 const scene=new T.Scene(), staticRoot=new T.Group();staticRoot.name='HQCommons';scene.add(staticRoot);
 const mats=new Map<string,T.MeshBasicMaterial>(),batches=new Map<T.Material,T.BufferGeometry[]>();
 function material(c:string){if(!mats.has(c))mats.set(c,new T.MeshBasicMaterial({color:c,vertexColors:true}));return mats.get(c)!;}
 function add(g:T.BufferGeometry,c:string,p:[number,number,number],rotation?:[number,number,number],scale?:[number,number,number]){const o=new T.Mesh(g,material(c));o.position.set(...p);if(rotation)o.rotation.set(...rotation);if(scale)o.scale.set(...scale);o.updateMatrix();let geo=g.clone().applyMatrix4(o.matrix);if(geo.index)geo=geo.toNonIndexed();geo.deleteAttribute('uv');const normals=geo.getAttribute('normal'),pos=geo.getAttribute('position'),colors=new Float32Array(normals.count*3);for(let j=0;j<normals.count;j++){const ny=normals.getY(j),nx=normals.getX(j),nz=normals.getZ(j),shade=.68+Math.max(0,ny)*.32+nx*.08+nz*.05;const d=Math.hypot(pos.getX(j),pos.getZ(j)-2,pos.getY(j)-.5),warm=Math.pow(Math.max(0,1-d/6),2)*.12,base=new T.Color(c);colors[j*3]=shade+warm/Math.max(.001,base.r);colors[j*3+1]=shade+warm*.4/Math.max(.001,base.g);colors[j*3+2]=shade+warm*.06/Math.max(.001,base.b);}geo.setAttribute('color',new T.BufferAttribute(colors,3));if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material)!.push(geo);return o;}
 function box(p:[number,number,number],s:[number,number,number],c:string,r=.06,rot=0){return add(new RoundedBoxGeometry(...s,2,Math.min(r,...s.map(a=>a/3))),c,p,[0,rot,0]);}
 function ball(p:[number,number,number],s:[number,number,number],c:string){return add(new T.SphereGeometry(1,12,8),c,p,undefined,s);}
 function cyl(p:[number,number,number],r:number,h:number,c:string,rt=r){return add(new T.CylinderGeometry(rt,r,h,16),c,p);}
 function path(x:number,z:number,w:number,d:number){box([x,.025,z],[w,.045,d],'#2A3550',.02);}
 // Flush to the mapped ground: no plinth, pedestal or separate diorama.
 // The actual MapLibre ground is the floor; no rectangular overlay plane.
 // Existing mapped footways form the circulation; only a short cafe approach is authored.
 path(-1.1,-3,5.4,1.1);
 cyl([0,.032,2],4.2,.028,'#2A3550');
 for(let x=-10;x<=10;x+=2)for(let z=-9;z<=9;z+=3){if(Math.abs(x)>2&&Math.abs(z)>1&&!(x<-1&&z<-3))ball([x+.2,.04,z],[.045,.025,.12],'#2A3550');}
 // Cafe with curved corners, striped canopy, open door and warm timber.
 box([-3.8,1.5,-6.1],[7.2,3,3.4],'#232E47',.16);
 box([-3.8,3.06,-6.1],[7.65,.22,3.8],'#2A3550',.1);
 box([-3.8,3.27,-6.1],[7.25,.25,3.4],'#232E47',.1);
 for(const x of [-6,-1.7]){box([x,1.55,-4.38],[1.55,1.6,.035],'#FFB36B');box([x,1.55,-4.34],[.07,1.6,.05],'#232E47');box([x,1.55,-4.34],[1.55,.07,.05],'#232E47');}
 box([-3.8,1.12,-4.36],[1.3,2.24,.07],'#1B2436',.15);
 box([-3.8,1.35,-4.30],[.95,1.55,.04],'#FFD98A',.12);
 for(let i=0;i<12;i++)box([-7.1+i*.6,2.48,-3.75],[.6,.16,1.45],i%2?'#2A3550':'#232E47',.035);
 for(const x of [-7.1,-.5])cyl([x,1.22,-3.16],.055,2.4,'#2A3550');
 box([-3.8,2.92,-4.26],[2.45,.45,.12],'#232E47');
 // Broad steps and potted herbs at the door.
 box([-3.8,.08,-3.9],[1.75,.14,.7],'#2A3550');
 for(const x of [-7,-.6]){cyl([x,.29,-4],.28,.55,'#2A3550',.36);ball([x,.68,-4],[.38,.45,.35],'#2A3550');}
 // Outdoor cafe tables, stools, little cups.
 function table(x:number,z:number){cyl([x,.64,z],.60,.12,'#2A3550');cyl([x,.32,z],.085,.62,'#232E47');for(const a of [0,Math.PI]){const sx=x+Math.cos(a)*.9,sz=z+Math.sin(a)*.9;cyl([sx,.36,sz],.27,.10,'#2A3550');for(const k of [-1,1])box([sx+k*.14,.17,sz],[.055,.31,.055],'#232E47');}cyl([x-.15,.76,z],.07,.14,'#F2E9D8');cyl([x+.2,.76,z+.1],.07,.14,'#F2E9D8');}
 table(-5.2,-1.8);table(-2.5,-1.6);
 // Quiet garden: raised beds, handrail and flowering edges.
 for(const [x,z] of [[8,-5.1],[10.5,-5.1],[8,-2.9],[10.5,-2.9]]){
  box([x,.22,z],[1.9,.42,1.8],'#2A3550');box([x,.44,z],[1.65,.04,1.55],'#1B2436');
  for(let a=-.5;a<=.5;a+=.5)for(let b=-.45;b<=.45;b+=.45){cyl([x+a,.62,z+b],.02,.36,'#232E47');ball([x+a,.78,z+b],[.18,.22,.18],'#2A3550');ball([x+a+.05,.95,z+b],[.065,.065,.065],a<0?'#FFD98A':'#F2E9D8');}
 }
 for(let x=6.3;x<11.7;x+=1.05)box([x,.6,-7],[.10,1.2,.10],'#2A3550');
 box([9,.77,-7],[5.7,.09,.1],'#2A3550');box([9,.33,-7],[5.7,.09,.1],'#2A3550');
 // Campfire ring sits in the commons, with real seating.
 for(let i=0;i<12;i++){const a=i*Math.PI/6;ball([Math.cos(a)*.64,.12,2+Math.sin(a)*.64],[.18,.13,.14],'#2A3550');}
 for(const k of [-1,1]){const log=add(new T.CylinderGeometry(.09,.1,.9,8),'#232E47',[0,.15,2],[Math.PI/2,0,k*.6]);void log;}
 function bench(x:number,z:number,yaw=0){const g=new T.Group();const parts:[T.BufferGeometry,string,[number,number,number]][]=[[new RoundedBoxGeometry(1.7,.12,.38,2,.04),'#2A3550',[0,.42,0]],[new RoundedBoxGeometry(1.7,.4,.10,2,.04),'#2A3550',[0,.75,-.18]]];for(const dx of [-.6,.6])parts.push([new T.BoxGeometry(.08,.42,.3),'#232E47',[dx,.2,0]]);for(const [geo,c,p]of parts){const v=new T.Vector3(...p).applyAxisAngle(new T.Vector3(0,1,0),yaw);add(geo,c,[x+v.x,v.y,z+v.z],[0,yaw,0]);}return g;}
 bench(-2.3,2,-Math.PI/2);bench(2.2,2,Math.PI/2);bench(0,4.2,Math.PI);
 // A small shared bookshelf and music corner.
 box([-8, .12,5],[3.8,.22,3.4],'#232E47');
 box([-9,.7,5.7],[1.2,1.3,.35],'#2A3550');
 for(let i=0;i<7;i++)box([-9.45+i*.14,.7,5.48],[.1,.37,.22],['#FFB36B','#FFD98A','#F2E9D8','#2A3550'][i%4],.01);
 bench(-8.2,4.7,.2);
 // Trees: soft irregular crowns, trunks and grounded pools of shade.
 const treeSpots=[[-9,-8],[-9,-3],[-10,2],[-9,7],[9,-8],[10,-.5],[9,7],[4,8],[-3,8]];
 for(let i=0;i<treeSpots.length;i++){const [x,z]=treeSpots[i];cyl([x,1.1,z],.12,2.2,'#232E47');const c=['#232E47','#2A3550','#232E47'][i%3];ball([x,2.35,z],[1.0,1.2,.95],c);ball([x+.55,2.15,z+.1],[.7,.8,.7],c);ball([x-.5,2.3,z-.25],[.7,.9,.75],c);}
 // Low hedges and lanterns leave paths open onto the real map.
 for(const x of [-11,11])for(let z=-7;z<=7;z+=3.5)box([x,.32,z],[.65,.65,2.6],'#232E47',.28);
 for(const [x,z]of [[-1.8,-8],[1.8,7],[-8,0],[8,0]]){cyl([x,.9,z],.035,1.8,'#2A3550');box([x,1.8,z],[.27,.28,.27],'#FFD98A');}
 for(const [m,geos] of batches){const g=mergeGeometries(geos);if(g){const mesh=new T.Mesh(g,m);mesh.name='Commons_'+(m as T.MeshBasicMaterial).color.getHexString();staticRoot.add(mesh);}geos.forEach(g=>g.dispose());}
 // Local hand-lettered wayfinding belongs to the scene, not a fixed overlay.
 function sign(text:string,x:number,y:number,z:number,w:number){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;c.clearRect(0,0,1024,256);c.fillStyle='#fff6e6';c.font='500 94px Georgia';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,130);const tx=new T.CanvasTexture(canvas);tx.colorSpace=T.SRGBColorSpace;const o=new T.Mesh(new T.PlaneGeometry(w,w/4),new T.MeshBasicMaterial({map:tx,transparent:true,depthWrite:false}));o.position.set(x,y,z);scene.add(o);}
 sign('the little commons',-3.8,2.93,-4.18,2.25);
 const source=(await new GLTFLoader().loadAsync(glb)).scene;
 const textures=await Promise.all(sigils.map(u=>new T.TextureLoader().loadAsync(u)));textures.forEach(t=>{t.colorSpace=T.SRGBColorSpace;t.flipY=false;});
 const muses:T.Group[]=[];
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const sc=shadowCanvas.getContext('2d')!,grad=sc.createRadialGradient(32,32,0,32,32,32);grad.addColorStop(0,'rgba(50,65,42,.22)');grad.addColorStop(.5,'rgba(50,65,42,.12)');grad.addColorStop(1,'rgba(50,65,42,0)');sc.fillStyle=grad;sc.fillRect(0,0,64,64);const shadowTexture=new T.CanvasTexture(shadowCanvas);
 const shadows:T.Mesh[]=[];
 const selection=new T.Mesh(new T.RingGeometry(.37,.41,48),new T.MeshBasicMaterial({color:'#fdf4d9',side:T.DoubleSide,transparent:true,opacity:.92,depthWrite:false}));selection.rotation.x=-Math.PI/2;selection.position.y=.069;scene.add(selection);
 for(let i=0;i<PEOPLE.length;i++){
  const root=source.clone(true);root.name='Muse_'+i;root.userData.person=i;
  root.traverse(o=>{if(o instanceof T.Mesh){o.userData.person=i;mapMeshMaterials(o,m=>paintMuseMaterial(m,PEOPLE[i].color,textures[i%2]));}});
  // Original small accessories: short scarves, a shoulder pouch, a stitched collar.
  const accent=mat(PEOPLE[i].accent);
  const accessory=new T.Group();accessory.name='OriginalAccessory_'+i;
  const scarf=new T.Mesh(new T.TorusGeometry(.22,.035,6,24),accent);scarf.rotation.x=Math.PI/2;scarf.position.set(0,.435,.02);accessory.add(scarf);
  if(i%3===0){const tail=new T.Mesh(new RoundedBoxGeometry(.07,.18,.035,2,.015),accent);tail.position.set(.12,.36,.21);tail.rotation.z=-.2;accessory.add(tail);}
  if(i%3===1){const pouch=new T.Mesh(new RoundedBoxGeometry(.18,.17,.07,2,.04),accent);pouch.position.set(.25,.31,.13);pouch.rotation.z=-.12;accessory.add(pouch);const strap=new T.Mesh(new T.TorusGeometry(.255,.012,4,24,.0+Math.PI*1.5),accent);strap.rotation.z=.6;strap.position.set(0,.39,.02);accessory.add(strap);}
  if(i%3===2){const patch=new T.Mesh(new T.CircleGeometry(.035,6),accent);patch.position.set(-.12,.34,.27);accessory.add(patch);}
  if(i===4){const book=new T.Group();book.name='ReadingBook';book.position.set(-.10,.34,.24);book.rotation.x=-.55;book.add(new T.Mesh(new RoundedBoxGeometry(.19,.04,.22,2,.012),mat('#2A3550')));const pages=new T.Mesh(new T.BoxGeometry(.17,.018,.19),mat('#F2E9D8'));pages.position.y=.022;book.add(pages);accessory.add(book);}
  if(i===3){const can=new T.Group();can.name='GardenCan';can.position.set(.26,.31,.14);const waterMat=mat('#85bfb1');can.add(new T.Mesh(new T.CylinderGeometry(.05,.055,.10,12),waterMat));const spout=new T.Mesh(new T.CylinderGeometry(.012,.014,.11,8),waterMat);spout.rotation.x=1.0;spout.position.set(0,.015,.065);can.add(spout);const handle=new T.Mesh(new T.TorusGeometry(.04,.009,5,12),waterMat);handle.position.set(0,.02,-.04);can.add(handle);const drops=new T.Group();drops.name='GardenDrops';for(let d=0;d<3;d++){const drop=new T.Mesh(new T.SphereGeometry(.008,6,4),new T.MeshBasicMaterial({color:'#6FA8C9'}));drop.position.set(0,-.05-d*.04,.13+d*.015);drops.add(drop);}can.add(drops);accessory.add(can);}
  root.add(accessory);scene.add(root);muses.push(root);
  const shadow=new T.Mesh(new T.PlaneGeometry(1.0,.8),new T.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.065;scene.add(shadow);shadows.push(shadow);
 }
 const treeShadows:T.Mesh[]=[];
 for(const [x,z]of treeSpots){const shadow=new T.Mesh(new T.PlaneGeometry(3.6,3.3),new T.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,opacity:.65}));shadow.rotation.x=-Math.PI/2;shadow.position.set(x,.002,z);scene.add(shadow);treeShadows.push(shadow);}
 const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=128;const gc=glowCanvas.getContext('2d')!,gg=gc.createRadialGradient(64,64,0,64,64,64);gg.addColorStop(0,'rgba(255,158,69,.26)');gg.addColorStop(.3,'rgba(255,158,69,.12)');gg.addColorStop(1,'rgba(255,158,69,0)');gc.fillStyle=gg;gc.fillRect(0,0,128,128);const pool=new T.Mesh(new T.PlaneGeometry(11,11),new T.MeshBasicMaterial({map:new T.CanvasTexture(glowCanvas),transparent:true,depthWrite:false}));pool.rotation.x=-Math.PI/2;pool.position.set(0,.047,2);scene.add(pool);
 const fire=new T.Group();fire.name='Fire';scene.add(fire);fire.position.set(0,.28,2);
 for(let i=0;i<3;i++){const f=new T.Mesh(new T.SphereGeometry(1,8,6),new T.MeshBasicMaterial({color:['#ef9c55','#ffd27d','#ffe6ac'][i]}));f.position.set((i-1)*.12,.18+i*.04,0);f.scale.set(.15-i*.025,.37-i*.05,.13);fire.add(f);}
 scene.add(new T.HemisphereLight('#7E93B8','#101623',1.7));const fireLight=new T.PointLight('#FF9E45',5,10,1.7);fireLight.position.set(0,.7,2);scene.add(fireLight);
 const updateInstances=instanceMovingMeshes(scene,[...muses,...shadows,...treeShadows]);
 let selected=0;
 function update(t:number,index:number){selected=index;for(let i=0;i<muses.length;i++){const p=positionAt(i,t),root=muses[i];root.position.set(p.x,surfaceHeightAt(p.x,p.z)+.006+(p.moving?Math.abs(Math.sin(t*5+i))*.018:Math.sin(t*1.8+i)*.005),p.z);const turn=conversationAt(t),partner=turn?.person===i?turn.listener:turn?.listener===i?turn.person:undefined;const q=partner===undefined?null:positionAt(partner,t);const target=p.moving?p.yaw:q?Math.atan2(q.x-p.x,q.z-p.z):i===3?Math.PI/2:Math.sin(i*2)*.45;root.rotation.y=target;root.rotation.z=p.moving?Math.sin(t*5+i)*.035:0;if(i===3){const drops=root.getObjectByName('GardenDrops');if(drops){const tending=!p.moving&&partner===undefined;drops.scale.setScalar(tending?1:0);drops.position.y=-((t*.08)%.04);}}shadows[i].position.x=p.x;shadows[i].position.z=p.z;shadows[i].position.y=surfaceHeightAt(p.x,p.z)+.002;}const p=positionAt(selected,t);selection.position.x=p.x;selection.position.z=p.z;selection.position.y=surfaceHeightAt(p.x,p.z)+.004;updateInstances();fire.children.forEach((f,i)=>{f.scale.y=(.37-i*.05)*(1+Math.sin(t*8+i*3)*.12);});}
 update(0,0);
 return {scene,muses,selection,update,sourceHeight:new T.Box3().setFromObject(source).getSize(new T.Vector3()).y};
}
