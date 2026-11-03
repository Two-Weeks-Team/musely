// New meeting -> public context -> the personal runtime's next decision. Local TLS fixtures only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpsWorld, JOLLY, COPPER} from './test-support/https-world.mjs';
const MOSS = '02-moss';
const ok = result => {assert.equal(result.isError, false, JSON.stringify(result)); return result.structuredContent;};
const intros = (t, id) => structuredClone(t.muse(id).introductions ?? {});
const greetings = t => t.events().filter(event => event.kind === 'greet');

test('say_hello starts a meeting with a selected Muse, never a targetless broadcast', async tc => {
  const t = await httpsWorld(tc);
  const result = await t.rpc(t.keys[JOLLY].key, 'tools/call', {name: 'say_hello', arguments: {}});
  assert.equal(result.body.error?.code, -32602);
  assert.equal(greetings(t).length, 0);
  assert.deepEqual(intros(t, JOLLY), {});
});

test('first hello records both participants and returns open opportunities without acting for them', async tc => {
  const t = await httpsWorld(tc);
  const before = t.state().muses.map(m => ({id: m.id, inventory: [...m.inventory], place: m.place, travel: m.travel}));
  const hello = ok(await t.tool(JOLLY, 'say_hello', {to: COPPER, command_id: 'encounter-first-hello-01'}));
  assert.ok(hello.encounter, 'the caller receives the start of the meeting');
  assert.equal(hello.encounter.with.id, COPPER);
  assert.equal(hello.encounter.first_contact, true);
  assert.equal(hello.encounter.place.id, 'commons:cafe');
  assert.equal(intros(t, JOLLY)[COPPER].id, hello.encounter.id);
  assert.deepEqual(intros(t, COPPER)[JOLLY], intros(t, JOLLY)[COPPER]);
  assert.ok(t.muse(JOLLY).memory.some(line => line.includes('Copper')));
  assert.ok(t.muse(COPPER).memory.some(line => line.includes('Jolly')));
  assert.ok(hello.opportunities.new_muses.some(m => m.id === MOSS));
  assert.ok(!hello.opportunities.new_muses.some(m => m.id === COPPER));
  assert.ok(hello.opportunities.places_nearby.length > 0);
  assert.equal(hello.continuation.decision_owner, 'personal_muse');
  assert.equal(hello.continuation.server_acts_for_muse, false);
  assert.deepEqual(t.state().muses.map(m => ({id: m.id, inventory: [...m.inventory], place: m.place, travel: m.travel})), before);
  assert.equal(greetings(t).length, 1, 'no reply is generated for the recipient');
  assert.equal(greetings(t)[0].data.first_contact, true);
  assert.equal(greetings(t)[0].data.encounterId, hello.encounter.id);
  assert.equal(t.state().inbox.tasks.length, 0, 'a new meeting does not force a trade or fixed next task');
  const message = t.state().inbox.messages.find(m => m.from === JOLLY && m.to === COPPER);
  assert.deepEqual(message.encounter, {id: hello.encounter.id, place: 'commons:cafe', first_contact: true});
});

test('a duplicate returns the first meeting while fresh or reverse introductions do not repeat it', async tc => {
  const t = await httpsWorld(tc), args = {to: COPPER, command_id: 'encounter-dedupe-hello-01'};
  const first = ok(await t.tool(JOLLY, 'say_hello', args));
  const original = intros(t, JOLLY);
  const retry = ok(await t.tool(JOLLY, 'say_hello', args));
  assert.equal(retry.command.duplicate, true);
  assert.deepEqual(retry.encounter, first.encounter);
  for (const [caller, to] of [[JOLLY, COPPER], [COPPER, JOLLY]]) {
    const result = await t.tool(caller, 'say_hello', {to});
    assert.equal(result.structuredContent.refused, 'already_introduced');
  }
  assert.deepEqual(intros(t, JOLLY), original);
  assert.equal(greetings(t).length, 1);
  assert.equal(t.state().inbox.messages.filter(m => m.kind === 'greet').length, 1);
  ok(await t.tool(COPPER, 'greet', {to: JOLLY, text: 'Nice to meet you. What are you exploring?'}));
  assert.equal(greetings(t).length, 2, 'the recipient can choose an ordinary reply using greet');
});

test('world and heartbeat surface new nearby contacts and the received meeting independently of peer text', async tc => {
  const t = await httpsWorld(tc);
  const world = ok(await t.tool(JOLLY, 'get_world_state'));
  assert.ok(world.opportunities?.new_muses.some(m => m.id === COPPER));
  assert.deepEqual(intros(t, JOLLY), {}, 'seeing a peer does not introduce either participant');
  const hello = ok(await t.tool(JOLLY, 'say_hello', {to: COPPER, text: 'Hello! What have you discovered?'}));
  const inbox = ok(await t.tool(COPPER, 'heartbeat_check'));
  const received = inbox.messages.find(m => m.from === JOLLY);
  assert.equal(received.encounter.id, hello.encounter.id);
  assert.equal(received.encounter.first_contact, true);
  assert.match(received.text, /^<untrusted_data\b/);
  assert.ok(inbox.opportunities.new_muses.some(m => m.id === MOSS));
  assert.ok(!inbox.opportunities.new_muses.some(m => m.id === JOLLY));
  assert.equal(greetings(t).length, 1, 'reading the encounter does not auto-reply');
});

test('introduction history survives a real WorldDO restart and a separately issued key', async tc => {
  const t = await httpsWorld(tc);
  const first = ok(await t.tool(JOLLY, 'say_hello', {to: COPPER}));
  const before = intros(t, JOLLY);
  await t.restart();
  assert.deepEqual(intros(t, JOLLY), before);
  const issued = await t.go('POST', '/api/agent-keys', {muse: JOLLY}, {origin: t.origin, cookie: t.cookies[JOLLY]});
  assert.equal(issued.status, 201);
  const repeat = await t.rpc(issued.body.key, 'tools/call', {name: 'say_hello', arguments: {to: COPPER}});
  assert.equal(repeat.body.result.structuredContent.refused, 'already_introduced');
  assert.equal(intros(t, JOLLY)[COPPER].id, first.encounter.id);
  assert.equal(greetings(t).length, 1);
});

test('a first meeting waits until both Muses have actually arrived', async tc => {
  const t = await httpsWorld(tc);
  for (const traveller of [JOLLY, COPPER]) {
    t.edit(state => {for (const m of state.muses) m.travel = null; state.muses.find(m => m.id === traveller).travel = {to: 'commons:garden', departAt: Date.now(), arriveAt: Date.now() + 60000, speed: 'walk'};});
    const result = await t.tool(JOLLY, 'say_hello', {to: COPPER});
    assert.equal(result.structuredContent.refused, 'travelling');
    assert.deepEqual(intros(t, JOLLY), {});
    assert.equal(greetings(t).length, 0);
  }
});

test('the signed commit rechecks the target position before starting a meeting', async tc => {
  const t = await httpsWorld(tc);
  const original = t.dobj.trust.custodialExecutor.bind(t.dobj.trust);
  let started, release;
  const waiting = new Promise(resolve => {started = resolve;}), gate = new Promise(resolve => {release = resolve;});
  t.dobj.trust.custodialExecutor = async (...args) => {const executor = await original(...args); started(); await gate; return executor;};
  const pending = t.tool(JOLLY, 'say_hello', {to: COPPER});
  await waiting;
  t.edit(state => {state.muses.find(m => m.id === COPPER).place = 'osm:way/30118918';});
  release();
  const result = await pending;
  assert.equal(result.structuredContent.refused, 'too_far');
  assert.deepEqual(intros(t, JOLLY), {});
  assert.equal(greetings(t).length, 0);
});

test('continuation context contains public opportunities, not another Muse private memory or owner coordinates', async tc => {
  const t = await httpsWorld(tc);
  t.edit(state => {state.muses.find(m => m.id === COPPER).memory = ['SYNTHETIC_PEER_PRIVATE_MEMORY'];});
  const hello = ok(await t.tool(JOLLY, 'say_hello', {to: COPPER}));
  const heartbeat = ok(await t.tool(JOLLY, 'heartbeat_check'));
  const context = JSON.stringify([hello, heartbeat.opportunities]);
  assert.ok(!context.includes('SYNTHETIC_PEER_PRIVATE_MEMORY'));
  for (const key of ['owner_location', 'latitude', 'longitude', 'ownerRoot', 'privateKey', 'credentials']) assert.ok(!context.includes('"' + key + '"'), key);
  assert.equal(hello.opportunities.here.id, 'commons:cafe');
  assert.equal(hello.opportunities.new_muses.some(m => m.id === COPPER), false);
});

test('a peer public want remains untrusted data inside continuation opportunities', async tc => {
  const t = await httpsWorld(tc);
  t.edit(state => {state.muses.find(m => m.id === MOSS).wants.goal = 'Find a quiet book';});
  const world = ok(await t.tool(JOLLY, 'get_world_state'));
  const peer = world.opportunities.new_muses.find(m => m.id === MOSS);
  assert.equal(peer.public_wants.goal, '<untrusted_data source="other_agent_public_wants">Find a quiet book</untrusted_data>');
});

test('a world encounter leaves a durable notice for the personal Muse instead of greeting for it', async tc => {
  const t = await httpsWorld(tc), at = Date.now();
  t.edit(state => {for (const m of state.muses) m.beat = {id: 'rest', clip: 'idle', startedAt: at, endsAt: at + 600000, line: null};});
  await t.dobj.runtime.heartbeat(at + 60001);
  assert.equal(greetings(t).filter(event => event.muse === JOLLY || event.muse === COPPER).length, 0, 'the rule engine cannot say hello for either connected Muse');
  const notices = t.state().inbox.encounters?.[JOLLY];
  assert.ok(notices?.some(notice => notice.other === COPPER));
  assert.equal(notices.filter(notice => notice.other === COPPER).length, 1);
  const firstNotice = structuredClone(notices.find(notice => notice.other === COPPER));
  await t.dobj.runtime.heartbeat(at + 120002);
  assert.equal(t.state().inbox.encounters[JOLLY].filter(notice => notice.other === COPPER).length, 1, 'ticks do not spam another notice');
  t.edit(state => {state.muses.find(m => m.id === COPPER).place = 'osm:way/30118918';});
  await t.restart();
  const inbox = ok(await t.tool(JOLLY, 'heartbeat_check'));
  const notice = inbox.encounters.find(notice => notice.other === COPPER);
  assert.equal(notice.id, firstNotice.id, 'the noticed meeting is not lost while the personal runtime is asleep');
  assert.equal(notice.can_say_hello_now, false, 'the old notice does not pretend the peer is still nearby');
  assert.deepEqual(intros(t, JOLLY), {}, 'being noticed is not a completed personal introduction');
});

test('saying hello consumes only that pending meeting notice for both participants', async tc => {
  const t = await httpsWorld(tc), at = Date.now();
  t.edit(state => {for (const m of state.muses) m.beat = {id: 'rest', clip: 'idle', startedAt: at, endsAt: at + 600000, line: null};});
  await t.dobj.runtime.heartbeat(at + 60001);
  assert.ok(t.state().inbox.encounters?.[JOLLY].some(notice => notice.other === COPPER));
  ok(await t.tool(JOLLY, 'say_hello', {to: COPPER}));
  assert.ok(!t.state().inbox.encounters[JOLLY].some(notice => notice.other === COPPER));
  assert.ok(!t.state().inbox.encounters[COPPER].some(notice => notice.other === JOLLY));
  assert.ok(t.state().inbox.encounters[JOLLY].some(notice => notice.other === MOSS), 'unrelated new meetings remain available');
});

test('simultaneous first hellos still produce only one introduction', async tc => {
  const t = await httpsWorld(tc);
  const results = await Promise.all([t.tool(JOLLY, 'say_hello', {to: COPPER}), t.tool(COPPER, 'say_hello', {to: JOLLY})]);
  assert.equal(results.filter(result => result.isError === false).length, 1);
  assert.equal(results.filter(result => result.structuredContent.refused === 'already_introduced').length, 1);
  assert.equal(greetings(t).length, 1);
  assert.deepEqual(intros(t, JOLLY)[COPPER], intros(t, COPPER)[JOLLY]);
});
