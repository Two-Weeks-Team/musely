/** Fixed, server-owned NPC identities. Role/appearance reuse never grants personal authority.
 * These 17 instances plus the seven existing unowned actors make 24 NPCs. No ID is
 * inferred from a prefix, display name, profile, client flag or appearance selection.
 */
export const RESIDENT_ROSTER_MODE = 'neighborhood-24-v1' as const;
export const RESIDENT_INSTANCES = Object.freeze([
  {id:'nr_alba',name:'Alba',roleId:'01-sunny',appearanceId:'01-sunny',home:'commons:cafe'},
  {id:'nr_basil',name:'Basil',roleId:'02-moss',appearanceId:'02-moss',home:'commons:garden'},
  {id:'nr_cedar',name:'Cedar',roleId:'03-ripple',appearanceId:'03-ripple',home:'commons:hq'},
  {id:'nr_dara',name:'Dara',roleId:'04-ember',appearanceId:'04-ember',home:'commons:campfire'},
  {id:'nr_ellis',name:'Ellis',roleId:'05-bloom',appearanceId:'05-bloom',home:'commons:garden'},
  {id:'nr_fable',name:'Fable',roleId:'06-ink',appearanceId:'06-ink',home:'commons:bookshelf'},
  {id:'nr_grove',name:'Grove',roleId:'07-tempo',appearanceId:'07-tempo',home:'commons:bookshelf'},
  {id:'nr_harbor',name:'Harbor',roleId:'08-orbit',appearanceId:'08-orbit',home:'commons:benches'},
  {id:'nr_indigo',name:'Indigo',roleId:'09-copper',appearanceId:'09-copper',home:'commons:workbench'},
  {id:'nr_juniper',name:'Juniper',roleId:'02-moss',appearanceId:'02-moss',home:'commons:garden'},
  {id:'nr_kite',name:'Kite',roleId:'03-ripple',appearanceId:'03-ripple',home:'commons:hq'},
  {id:'nr_linden',name:'Linden',roleId:'05-bloom',appearanceId:'05-bloom',home:'commons:benches'},
  {id:'nr_marlow',name:'Marlow',roleId:'06-ink',appearanceId:'06-ink',home:'commons:bookshelf'},
  {id:'nr_nova',name:'Nova',roleId:'08-orbit',appearanceId:'08-orbit',home:'commons:benches'},
  {id:'nr_olive',name:'Olive',roleId:'01-sunny',appearanceId:'01-sunny',home:'commons:cafe'},
  {id:'nr_piper',name:'Piper',roleId:'07-tempo',appearanceId:'07-tempo',home:'commons:campfire'},
  {id:'nr_rowan',name:'Rowan',roleId:'04-ember',appearanceId:'04-ember',home:'commons:campfire'},
].map(x=>Object.freeze(x)));
export const residentInstance = (id:string) => RESIDENT_INSTANCES.find(r=>r.id===id) ?? null;
export const isResidentInstance = (id:string):boolean => residentInstance(id)!==null;
