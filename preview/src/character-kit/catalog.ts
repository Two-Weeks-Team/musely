// Ten-character Muse family. Mirrors character-kit/source/variant_spec.py and
// character-kit/manifest.json (a regression test keeps all three identical).
export const MUSE_VARIANTS=[
 {id:'00-jolly',name:'Jolly',role:'Base',personality:'Warm, attentive companion; the reference standard',body:'#E8DDC7',accent:'#D9A38D',signature:null,tempo:1},
 {id:'01-sunny',name:'Sunny',role:'Host',personality:'Outgoing, welcomes neighbors',body:'#E7B75B',accent:'#D9886C',signature:'welcome_neighbors',tempo:1.12},
 {id:'02-moss',name:'Moss',role:'Gardener',personality:'Patient, notices and cares for small things',body:'#9CAD82',accent:'#BA8068',signature:'water_plants',tempo:.9},
 {id:'03-ripple',name:'Ripple',role:'Explorer',personality:'Curious, observant, enjoys the long way home',body:'#83B8AE',accent:'#DBC5A1',signature:'inspect_map',tempo:1},
 {id:'04-ember',name:'Ember',role:'Storykeeper',personality:'Calm, invites others to stay and listen',body:'#CC8F73',accent:'#E6BE77',signature:'tell_story',tempo:.85},
 {id:'05-bloom',name:'Bloom',role:'Listener',personality:'Empathetic, gives people space',body:'#D5A0B1',accent:'#9AAE91',signature:'reassure',tempo:.9},
 {id:'06-ink',name:'Ink',role:'Reader',personality:'Thoughtful, focused, quietly playful',body:'#91ABC8',accent:'#826D9B',signature:'read_book',tempo:.95},
 {id:'07-tempo',name:'Tempo',role:'Music Friend',personality:'Playful rhythm and shared company',body:'#AE9CCB',accent:'#E5CF90',signature:'music_bounce',tempo:1.1},
 {id:'08-orbit',name:'Orbit',role:'Stargazer',personality:'Dreamy, reflective, attentive to the sky',body:'#8D96B8',accent:'#DCC589',signature:'observe_sky',tempo:.85},
 {id:'09-copper',name:'Copper',role:'Maker',personality:'Practical, inventive, enjoys fixing things',body:'#AD8E79',accent:'#7EA6A2',signature:'inspect_gadget',tempo:1},
] as const;
export type MuseVariant=typeof MUSE_VARIANTS[number];
export type MuseVariantId=MuseVariant['id'];
export const variantById=(id:string)=>{const v=MUSE_VARIANTS.find(v=>v.id===id);if(!v)throw Error('Unknown Muse variant: '+id);return v;};

/** World residents keep their person IDs and lines; each wears the variant that matches their everyday activity. */
export const RESIDENT_VARIANTS:readonly MuseVariantId[]=['00-jolly','01-sunny','07-tempo','02-moss','06-ink','08-orbit','05-bloom','03-ripple'];

export const SHARED_CLIPS=['idle_breathe','walk','look_around','think','listen','talk','wave','sit_down','sit_idle','stand_up','celebrate','offer_item'] as const;
export const SIGNATURE_CLIPS={welcome_neighbors:{frames:60,loop:false},water_plants:{frames:96,loop:true},inspect_map:{frames:96,loop:true},tell_story:{frames:96,loop:true},reassure:{frames:72,loop:true},read_book:{frames:96,loop:true},music_bounce:{frames:48,loop:true},observe_sky:{frames:96,loop:true},inspect_gadget:{frames:96,loop:true}} as const;
/** Chapter-10 action clips on the shared rig (character-kit/source/variant_spec.py ACTION_CLIPS). Two-actor clips carry
 * their contact frame, authored for an identical partner `partner` metres in front, facing back. */
export const ACTION_CLIPS={drink:{frames:96,loop:true,socket:'Socket_Hand_R'},plant:{frames:96,loop:false},high_five:{frames:60,loop:false,contactFrame:24,partner:.9}} as const;
export const SINGLE_PLAY=new Set<string>(['wave','sit_down','stand_up','celebrate','offer_item','welcome_neighbors',...Object.entries(ACTION_CLIPS).filter(([,c])=>!c.loop).map(([n])=>n)]);
export const EXPRESSIONS=['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight'] as const;

/** Mean sRGB of the shared fleece albedo; a variant tints fleece by palette / mean in linear light. */
export const FLEECE_MEAN='#D6C6AB';
const toLinear=(h:string)=>[1,3,5].map(i=>{const c=parseInt(h.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
export function fleeceFactor(body:string):[number,number,number]{const p=toLinear(body),m=toLinear(FLEECE_MEAN);return [p[0]/m[0],p[1]/m[1],p[2]/m[2]];}

export const KIT_RUNTIME='/character-kit/runtime/';
export const lodUrl=(lod:0|1|2,base=KIT_RUNTIME)=>`${base}base/lod${lod}.glb`;
export const attachmentUrl=(id:MuseVariantId,base=KIT_RUNTIME)=>id==='00-jolly'?null:`${base}attachments/${id}.glb`;
