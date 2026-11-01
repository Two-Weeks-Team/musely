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
/** Chapter-10 action clips on the shared rig (mirrors character-kit/source/variant_spec.py ACTION_CLIPS).
 * contact/partner: two-actor clips, authored for a partner PARTNER_DISTANCE metres in front, facing back, playing `partner`.
 * stride: locomotion clips whose phase follows travelled distance (metres per cycle). prop: shared prop shown while playing. */
export type ActionClip={readonly frames:number;readonly loop:boolean;readonly contact?:number;readonly partner?:string;readonly stride?:number;readonly prop?:string};
export const PARTNER_DISTANCE=.9;
export const ACTION_CLIPS:Readonly<Record<string,ActionClip>>={
 drink:{frames:96,loop:true},plant:{frames:96,loop:false},high_five:{frames:60,loop:false,contact:24,partner:'high_five'},
 nod:{frames:36,loop:false},head_shake:{frames:48,loop:false},point_way:{frames:60,loop:false},clap:{frames:48,loop:true},
 fist_bump:{frames:48,loop:false,contact:20,partner:'fist_bump'},
 handoff_give:{frames:72,loop:false,contact:32,partner:'handoff_receive'},handoff_receive:{frames:72,loop:false,contact:32,partner:'handoff_give'},
 eat:{frames:96,loop:true},board:{frames:48,loop:false},bus_sway:{frames:96,loop:true},stretch:{frames:96,loop:false},feed_birds:{frames:72,loop:true},
 pick_up:{frames:72,loop:false},write_note:{frames:96,loop:true},photo:{frames:72,loop:false},yawn:{frames:72,loop:false},hammer:{frames:48,loop:true},
 lantern_hold:{frames:96,loop:true},dance:{frames:96,loop:true},
 carry_walk:{frames:32,loop:true,stride:.27},run:{frames:16,loop:true,stride:.222},
};
/** Walking stride contract: metres of route travel per clip cycle, for walk and the strided action clips. */
export const WALK_STRIDE={meters:.27,seconds:32/24} as const;
export function strideOf(action:string):{meters:number;seconds:number}|null{
 if(action==='walk')return WALK_STRIDE;
 const c=ACTION_CLIPS[action];return c?.stride?{meters:c.stride,seconds:c.frames/24}:null;
}
export const SINGLE_PLAY=new Set<string>(['wave','sit_down','stand_up','celebrate','offer_item','welcome_neighbors',...Object.entries(ACTION_CLIPS).filter(([,c])=>!c.loop).map(([n])=>n)]);
export const EXPRESSIONS=['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight'] as const;

/** Mean sRGB of the shared fleece albedo; a variant tints fleece by palette / mean in linear light. */
export const FLEECE_MEAN='#D6C6AB';
const toLinear=(h:string)=>[1,3,5].map(i=>{const c=parseInt(h.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
export function fleeceFactor(body:string):[number,number,number]{const p=toLinear(body),m=toLinear(FLEECE_MEAN);return [p[0]/m[0],p[1]/m[1],p[2]/m[2]];}

export const KIT_RUNTIME='/character-kit/runtime/';
export const lodUrl=(lod:0|1|2,base=KIT_RUNTIME)=>`${base}base/lod${lod}.glb`;
export const attachmentUrl=(id:MuseVariantId,base=KIT_RUNTIME)=>id==='00-jolly'?null:`${base}attachments/${id}.glb`;
