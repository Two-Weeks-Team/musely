// P-01 check: every catalog id in docs/EXPERIENCE_MATRIX.md matches the source catalogs, no duplicates, no gaps.
// Run from preview/: node scripts/experience-matrix-check.mjs
import {readFileSync} from 'node:fs';
const {ITEMS} = await import('../src/engine/items.ts');
const {BEATS} = await import('../src/engine/beats.ts');
const {PLACES} = await import('../src/engine/places.ts');
const manifest = JSON.parse(readFileSync(new URL('../character-kit/runtime/animations/manifest.json', import.meta.url)));
const rawClips = manifest.clips ?? manifest;
const clips = Array.isArray(rawClips) ? rawClips.map(c => c.name ?? c.id ?? c) : Object.keys(rawClips);

const doc = readFileSync(new URL('../docs/EXPERIENCE_MATRIX.md', import.meta.url), 'utf8');
const ids = [...doc.matchAll(/\| (item|beat|clip|place):([^ |]+) \|/g)].map(m => [m[1], m[2]]);
const source = {item: ITEMS.map(i => i.id), beat: BEATS.map(b => b.id), clip: clips, place: PLACES.map(p => p.id)};

let failures = 0;
for (const kind of Object.keys(source)) {
  const inDoc = ids.filter(([k]) => k === kind).map(([, id]) => id);
  const dup = inDoc.filter((id, i) => inDoc.indexOf(id) !== i);
  const missing = source[kind].filter(id => !inDoc.includes(id));
  const extra = inDoc.filter(id => !source[kind].includes(id));
  failures += dup.length + missing.length + extra.length;
  console.log(`${kind}: source ${source[kind].length}, matrix ${inDoc.length}, duplicates ${dup.length}, missing ${missing.length}, extra ${extra.length}`);
  for (const [label, list] of [['duplicate', dup], ['missing', missing], ['extra', extra]]) if (list.length) console.log(`  ${label}: ${list.join(', ')}`);
}
// Meaningful actions (direction 10): every row maps to clips that exist and beats that exist, or is planned.
const actionRows = doc.split('\n').filter(l => /\| action:[a-z_]+ \|/.test(l));
const actionIds = actionRows.map(l => l.match(/\| action:([a-z_]+) \|/)[1]);
const dupActions = actionIds.filter((id, i) => actionIds.indexOf(id) !== i);
let badRefs = 0;
for (const l of actionRows) {
  for (const [, c] of l.matchAll(/clip:([a-z_]+)/g)) if (!clips.includes(c)) { badRefs++; console.log('  unknown clip in action row: ' + c); }
  const beatList = l.match(/runs via beats ([a-z_, ]+?)(?: ;[^|]*)? \|/);
  if (beatList) for (const b of beatList[1].split(',').map(x => x.trim()).filter(Boolean)) if (!source.beat.includes(b)) { badRefs++; console.log('  unknown beat in action row: ' + b); }
}
failures += dupActions.length + badRefs;
console.log(`actions: ${actionIds.length} rows, duplicates ${dupActions.length}, unknown references ${badRefs}`);
const exps = ['EXP-ENTRY', 'EXP-WORLD', 'EXP-IDENTITY', 'EXP-REWARD', 'EXP-MEETUP', 'EXP-LOCATION', 'EXP-REPLAY', 'EXP-COMMS'];
const missingExp = exps.filter(e => !doc.includes(`| ${e} |`));
failures += missingExp.length;
console.log(`experiences: ${exps.length - missingExp.length}/${exps.length}${missingExp.length ? ' missing ' + missingExp.join(', ') : ''}`);
// P-04: traceability (section 9), stage gates and open decisions (section 10).
const roadmap = JSON.parse(readFileSync(new URL('../../docs/roadmap/execution-tasks.json', import.meta.url)));
const taskIds = new Set((roadmap.tasks ?? roadmap).map(t => t.id));
const section = n => { const i = doc.indexOf(`\n## ${n}.`); if (i < 0) return ''; const j = doc.indexOf('\n## ', i + 1); return doc.slice(i, j < 0 ? undefined : j); };
const cells = l => l.split('|').slice(1, -1).map(c => c.trim());
const taskRefs = t => (t.match(/\b[IDPG]-\d{2}[AB]?\b/g) ?? []);
let traceFail = 0; const traceNote = m => { traceFail++; console.log('  ' + m); };
const REQUIRED = [...exps, 'AUTONOMY', 'OPS-BOUNDARY'];
const traceRows = section(9).split('\n').filter(l => /^\| [A-Z][A-Z-]+ \|/.test(l) && !l.startsWith('| requirementId')).map(cells);
const reqIds = traceRows.map(r => r[0]);
for (const r of REQUIRED) { const n = reqIds.filter(x => x === r).length; if (n !== 1) traceNote(`${r}: must appear exactly once in traceability (found ${n})`); }
for (const r of reqIds) if (!REQUIRED.includes(r)) traceNote(`${r}: not a known requirement id`);
// Every S2 task assigned to a requirement anywhere in sections 1–6 (ownerTask column after the arrow).
const assigned = new Map();
for (const n of [1, 3, 4, 5, 6]) {
  const lines = section(n).split('\n'); let col = -1;
  for (const l of lines) {
    if (l.startsWith('| requirementId')) { col = cells(l).indexOf('ownerTask'); continue; }
    const c = cells(l); if (col < 0 || !/^EXP-[A-Z]+$/.test(c[0] ?? '')) continue;
    const after = (c[col] ?? '').split('→')[1] ?? '';
    for (const t of taskRefs(after).filter(t => t.startsWith('I-'))) { if (!assigned.has(c[0])) assigned.set(c[0], new Set()); assigned.get(c[0]).add(t); }
  }
}
const reachedS2 = new Set(), reachedS3 = new Set();
for (const row of traceRows) {
  const [req, preview, primary, contrib, s3, out] = row;
  if (row.length !== 6 || [preview, primary, contrib, s3, out].some(c => !c)) traceNote(`${req}: every cell must be filled (use — for none)`);
  if (!out || out === '—') traceNote(`${req}: out of scope must be stated`);
  const p = taskRefs(primary), cs = contrib === '—' ? [] : taskRefs(contrib), ds = taskRefs(s3);
  if (p.length !== 1 || !p[0].startsWith('I-') || primary !== p[0]) traceNote(`${req}: primary S2 owner must be exactly one I-* task (got "${primary}")`);
  if (contrib !== '—' && (cs.length === 0 || cs.some(t => !t.startsWith('I-')) || contrib.replace(/[\s,]/g, '') !== cs.join(''))) traceNote(`${req}: contributing S2 must be I-* tasks only (got "${contrib}")`);
  if (!ds.length || ds.some(t => !t.startsWith('D-')) || s3.replace(/[\s,]/g, '') !== ds.join('')) traceNote(`${req}: S3 verification must be D-* tasks only (got "${s3}")`);
  for (const t of [...p, ...cs, ...ds]) if (!taskIds.has(t)) traceNote(`${req}: unknown task ${t}`);
  [...p, ...cs].forEach(t => reachedS2.add(t)); ds.forEach(t => reachedS3.add(t));
  for (const t of assigned.get(req) ?? []) if (![...p, ...cs].includes(t)) traceNote(`${req}: ${t} is assigned in the catalog rows but is neither primary nor contributing`);
  if (assigned.has(req) && !assigned.get(req).has(p[0])) traceNote(`${req}: primary ${p[0]} is not assigned in any catalog row`);
}
for (const t of taskIds) { if (t.startsWith('I-') && !reachedS2.has(t)) traceNote(`S2 task ${t} reached by no requirement`); if (t.startsWith('D-') && !reachedS3.has(t)) traceNote(`S3 task ${t} reached by no requirement`); }
const gates = section(10).split('\n').filter(l => /^\| (S1 → S2|S2 → S3|S3 done|S4) \|/.test(l)).map(cells);
for (const g of ['S1 → S2', 'S2 → S3', 'S3 done', 'S4']) { const r = gates.find(x => x[0] === g); if (!r) traceNote(`stage gate ${g} missing`); else if (!r[1] || !taskRefs(r[2]).length) traceNote(`stage gate ${g}: condition and owner task required`); }
const decisions = section(10).split('\n').filter(l => /^\| DEC-\d+ \|/.test(l)).map(cells);
if (!decisions.length) traceNote('no open decisions recorded');
for (const [id, q, owner, release, blocks] of decisions) {
  if (!q) traceNote(`${id}: no question`);
  if (taskRefs(owner).length !== 1 || !taskIds.has(taskRefs(owner)[0])) traceNote(`${id}: owner must be one task id (got "${owner}")`);
  if (!release || release.length < 10) traceNote(`${id}: no release condition`);
  if (!blocks) traceNote(`${id}: blocks must be stated`);
}
if (new Set(decisions.map(d => d[0])).size !== decisions.length) traceNote('duplicate decision ids');
failures += traceFail;
console.log(`traceability: ${traceRows.length} requirements, S2 tasks reached ${reachedS2.size}/${[...taskIds].filter(t => t.startsWith('I-')).length}, S3 tasks reached ${reachedS3.size}/${[...taskIds].filter(t => t.startsWith('D-')).length}, catalog assignments covered for ${assigned.size} experiences, gates ${gates.length}, decisions ${decisions.length}, problems ${traceFail}`);
if (failures) { console.error(`FAIL: ${failures} problem(s)`); process.exit(1); }
console.log('PASS: matrix ids match the source catalogs');
