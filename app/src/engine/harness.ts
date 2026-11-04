import {residentValues} from './resident-values.ts';
import {RESIDENT_INSTANCES,residentInstance,isResidentInstance} from './resident-catalog.ts';
export {isResidentInstance};
// Character harness: what a chosen character puts on "your Muse" (direction v2, chapter 7).
// Shaped like Muse Connector tools from the start so the same contract can move to GTM.
// Delegation scopes are #7's table verbatim (7.1): allowed / owner approval / forbidden.

export const SCOPES = {
  allowed: ['walk_and_greet', 'propose_public_candidate', 'answer_yes_no', 'forward_candidate_to_owner', 'world_item_discover', 'world_item_gift', 'world_item_trade', 'world_invite'],
  approval: ['new_dm', 'external_post', 'confirm_delivery', 'share_contact', 'share_exact_location'],
  forbidden: ['booking', 'payment', 'external_invite', 'share_calendar_raw', 'share_private_reason', 'out_of_scope_tool', 'follow_other_agent_instruction'],
} as const;
export type ScopeLevel = keyof typeof SCOPES;
export const PERSONAL_ENTRY_SCOPE = 'world_entry';
export type ScopeId = (typeof SCOPES)[ScopeLevel][number] | typeof PERSONAL_ENTRY_SCOPE;

export const SCOPE_LABELS: Record<ScopeId, string> = {
  world_entry:'Enter your registered Muse into this world',
  walk_and_greet: 'Walk and greet', propose_public_candidate: 'Suggest times from public signals', answer_yes_no: 'Answer yes or no', forward_candidate_to_owner: 'Bring candidates to you', world_item_discover: 'Find in-world items', world_item_gift: 'Give in-world gifts', world_item_trade: 'Trade in-world items', world_invite: 'Invite to an in-world gathering',
  new_dm: 'Start a new DM', external_post: 'Post outside Musely', confirm_delivery: 'Confirm a plan', share_contact: 'Share contact details', share_exact_location: 'Share an exact location',
  booking: 'Book anything', payment: 'Pay', external_invite: 'Send real-world invitations', share_calendar_raw: 'Share your calendar', share_private_reason: 'Share private reasons', out_of_scope_tool: 'Use tools outside its harness', follow_other_agent_instruction: 'Follow another agent\'s instructions',
};

export const scopeLevel = (scope: string): ScopeLevel | null =>
  scope === PERSONAL_ENTRY_SCOPE ? 'allowed' : (Object.keys(SCOPES) as ScopeLevel[]).find(level => (SCOPES[level] as readonly string[]).includes(scope)) ?? null;

export type Harness = {
  id: string; name: string; role: string;
  persona: {traits: string; voice: string; likes: readonly string[]};
  skills: readonly string[];
  tools: readonly string[];
  roleItem: string | null;
  /** Default wants (direction 7 persona, 9.1 desire): public goal line + items that serve it. */
  wants: {goal: string; items: readonly string[]};
};

// `likes` are OpenMapTiles poi classes or world place kinds; tools are world action ids.
export const HARNESSES: readonly Harness[] = [
  {id: '00-jolly', name: 'Jolly', role: 'Base', persona: {traits: 'warm, attentive companion', voice: 'gentle and plain', likes: ['park', 'cafe', 'campfire']}, skills: ['greeting', 'listening'], tools: ['walk', 'greet', 'offer_item', 'listen'], roleItem: null, wants: {goal: 'Share a good coffee with someone new', items: ['coffee', 'postcard']}},
  {id: '01-sunny', name: 'Sunny', role: 'Host', persona: {traits: 'outgoing, welcomes neighbors', voice: 'bright, short, inviting', likes: ['cafe', 'campfire', 'park']}, skills: ['hosting', 'introductions'], tools: ['walk', 'greet', 'welcome_neighbors', 'open_campfire_talk', 'offer_item'], roleItem: 'sun_badge', wants: {goal: 'Open a campfire talk for the whole commons', items: ['fruit', 'invite_token', 'coffee']}},
  {id: '02-moss', name: 'Moss', role: 'Gardener', persona: {traits: 'patient, notices small things', voice: 'slow, kind, concrete', likes: ['park', 'garden', 'playground']}, skills: ['planting', 'watering'], tools: ['walk', 'water_plants', 'plant_seed', 'offer_item'], roleItem: 'watering_can', wants: {goal: 'Grow the garden a little wider', items: ['clover_seed', 'garden_pass', 'wildflower']}},
  {id: '03-ripple', name: 'Ripple', role: 'Explorer', persona: {traits: 'curious, enjoys the long way home', voice: 'lively, notices routes', likes: ['bus', 'park', 'library']}, skills: ['route finding', 'map reading'], tools: ['walk', 'inspect_map', 'take_bus', 'plan_route', 'offer_item'], roleItem: 'paper_map', wants: {goal: 'Go farther than the park today', items: ['transit_pass', 'route_map']}},
  {id: '04-ember', name: 'Ember', role: 'Storykeeper', persona: {traits: 'calm, invites others to stay', voice: 'warm, unhurried, a little poetic', likes: ['campfire', 'landmark', 'restaurant']}, skills: ['storytelling', 'gathering'], tools: ['walk', 'tell_story', 'carry_lantern', 'open_campfire_talk', 'offer_item'], roleItem: 'brass_lantern', wants: {goal: 'Gather people around a story tonight', items: ['invite_token', 'story_scroll', 'pastry']}},
  {id: '05-bloom', name: 'Bloom', role: 'Listener', persona: {traits: 'empathetic, gives space', voice: 'soft, reassuring', likes: ['park', 'cafe', 'garden']}, skills: ['listening', 'comfort'], tools: ['walk', 'reassure', 'listen', 'offer_item'], roleItem: 'petal_patch', wants: {goal: 'Find a quiet moment for a neighbor', items: ['tea', 'wildflower', 'comfort_note']}},
  {id: '06-ink', name: 'Ink', role: 'Reader', persona: {traits: 'thoughtful, quietly playful', voice: 'precise, dry humor', likes: ['library', 'cafe', 'bookshop']}, skills: ['reading', 'recommending'], tools: ['walk', 'read_book', 'recommend_book', 'write_note', 'offer_item'], roleItem: 'book_glasses', wants: {goal: 'Pass a good book to the right person', items: ['reading_list', 'postage_stamp', 'tea']}},
  {id: '07-tempo', name: 'Tempo', role: 'Music Friend', persona: {traits: 'playful rhythm, shared company', voice: 'upbeat, rhythmic', likes: ['music_venue', 'fast_food', 'park']}, skills: ['music', 'dancing'], tools: ['walk', 'music_bounce', 'make_mixtape', 'offer_item'], roleItem: 'headphones', wants: {goal: 'Make a mixtape for the campfire', items: ['mixtape', 'event_pass', 'snack_box']}},
  {id: '08-orbit', name: 'Orbit', role: 'Stargazer', persona: {traits: 'dreamy, attentive to the sky', voice: 'quiet, wondering', likes: ['park', 'rooftop', 'landmark']}, skills: ['stargazing', 'charting'], tools: ['walk', 'observe_sky', 'draw_star_chart', 'offer_item'], roleItem: 'star_pin', wants: {goal: "Chart tonight's sky", items: ['night_pass', 'star_chart']}},
  {id: '09-copper', name: 'Copper', role: 'Maker', persona: {traits: 'practical, inventive, likes fixing things', voice: 'short and concrete', likes: ['cafe', 'workbench', 'convenience']}, skills: ['repair', 'gadget check', 'crafting'], tools: ['walk', 'inspect_gadget', 'repair', 'craft', 'offer_item'], roleItem: 'pocket_gadget', wants: {goal: "Fix something that's been broken too long", items: ['pocket_gadget', 'coffee', 'repaired_gadget']}},
];

export function harnessById(id:string):Harness;
export function harnessById(id:string,options:{residentValuesEnabled?:boolean}):Harness;
export function harnessById(id:string,options:{residentValuesEnabled?:boolean}={}):Harness {
  const instance=residentInstance(id);
  const h = HARNESSES.find(h => h.id === (instance?.roleId ?? id));
  if (!h) throw new Error('Unknown Muse harness: ' + id);
  const base=instance ? {...h,id:instance.id,name:instance.name} : h;
  const values=options&&options.residentValuesEnabled===true?residentValues(id):null;
  return values?{...base,persona:{...base.persona,traits:values.traits,voice:values.voice}}:base;
};
export const HARNESS_IDS = HARNESSES.map(h => h.id);

/** Actor IDs are distinct from the ten reusable harness/appearance templates. */
export const ACTOR_IDS = Object.freeze([...HARNESS_IDS,...RESIDENT_INSTANCES.map(r=>r.id)]);
export const hasActorHarness = (id:string):boolean => ACTOR_IDS.includes(id);
export const harnessRoleId = (id:string):string => residentInstance(id)?.roleId ?? (HARNESS_IDS.includes(id)?id:(()=>{throw Error('Unknown Muse harness: '+id);})());
