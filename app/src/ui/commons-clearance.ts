// Conservative XZ footprints of the existing authored commons in scene.ts.
// This is a stationary presentation clearance model, not map-building data or a walking navmesh.
// resident-slot-clearance.test.mjs executes scene.ts's actual geometry to catch drift in these footprints.
export type Point = {x: number; z: number};
type Obstacle = Point & ({kind: 'circle'; radius: number} | {kind: 'box'; width: number; depth: number; yaw: number});
// Existing actorBounds uses .45 m; add .05 m clearance. The checked-in LOD2 bind pose is < .40 m.
// This bound does not certify every attachment/action animation; full asset and GPU QA remain required.
export const PRESENTATION_RADIUS = .5;
export const SLOT_SPACING = 2 * PRESENTATION_RADIUS + .05;
const circle = (x: number, z: number, radius: number): Obstacle => ({kind: 'circle', x, z, radius});
const box = (x: number, z: number, width: number, depth: number, yaw = 0): Obstacle => ({kind: 'box', x, z, width, depth, yaw});
export const COMMONS_OBSTACLES: readonly Obstacle[] = [
  box(-3.8, -6.1, 7.2, 3.4), box(-3.8, -3.9, 1.75, .7),
  ...[-7.1, -.5].map(x => circle(x, -3.16, .055)),
  ...[-7, -.6].map(x => circle(x, -4, .4)),
  ...[[-5.2, -1.8], [-2.5, -1.6]].flatMap(([x, z]) => [circle(x, z, .6), circle(x - .9, z, .27), circle(x + .9, z, .27)]),
  ...[[8, -5.1], [10.5, -5.1], [8, -2.9], [10.5, -2.9]].map(([x, z]) => box(x, z, 1.9, 1.8)),
  box(9, -7, 5.7, .1), circle(0, 2, .84),
  ...[[-2.3, 2, -Math.PI / 2], [2.2, 2, Math.PI / 2], [0, 4.2, Math.PI], [-8.2, 4.7, .2]].map(([x, z, yaw]) => box(x, z, 1.7, .46, yaw)),
  box(-9, 5.6225, 1.2, .505),
  // Include the crowns too: the raised reading platform can bring the head up to their lower edge.
  ...[[-9, -8], [-9, -3], [-10, 2], [-9, 7], [9, -8], [10, -.5], [9, 7], [4, 8], [-3, 8]].map(([x, z]) => circle(x, z, 1.3)),
  ...[-11, 11].flatMap(x => [-7, -3.5, 0, 3.5, 7].map(z => box(x, z, .65, 2.6))),
  ...[[-1.8, -8], [1.8, 7], [-8, 0], [8, 0]].map(([x, z]) => circle(x, z, .135)),
];
export function obstacleDistance(p: Point, o: Obstacle): number {
  const dx = p.x - o.x, dz = p.z - o.z;
  if (o.kind === 'circle') return Math.hypot(dx, dz) - o.radius;
  const x = dx * Math.cos(o.yaw) - dz * Math.sin(o.yaw), z = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw);
  return Math.hypot(Math.max(0, Math.abs(x) - o.width / 2), Math.max(0, Math.abs(z) - o.depth / 2));
}
export const clearsCommons = (p: Point, radius = PRESENTATION_RADIUS) => COMMONS_OBSTACLES.every(o => obstacleDistance(p, o) >= radius);
/** A fixed grid gives different place groups a shared non-overlapping pool. Never spill beyond the authored commons. */
export function commonsCandidates(reserved: readonly Point[]): Point[] {
  const points: Point[] = [];
  for (let iz = 0; iz <= 16; iz++) for (let ix = 0; ix <= 19; ix++) {
    const p = {x: -9.975 + ix * SLOT_SPACING, z: -10 + iz * SLOT_SPACING};
    if (clearsCommons(p) && reserved.every(q => Math.hypot(p.x - q.x, p.z - q.z) >= 2 * PRESENTATION_RADIUS)) points.push(p);
  }
  return points;
}
/** Distance from another actor's centre to the contact movement segment. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
/** Conservative swept-circle check for an extra actor's brief contact gesture, not general travel routing. */
export function clearsContactMove(a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .05));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!clearsCommons({x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t}, PRESENTATION_RADIUS + .025)) return false;
  }
  return true;
}
