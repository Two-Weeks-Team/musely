/** World-02 opt-in visual controller. No world, inventory or attendee mutations. */
export type CampfireLod = 'near' | 'mid' | 'far' | 'hidden';
export interface ArrivalSnapshot {
  placeId: string; observedAt: number; receiptId: string;
  /** Only IDs whose arrival was established by the authoritative world adapter. */
  arrivedMuseIds: readonly string[];
}
export interface CampfireFrame {
  lod: CampfireLod; attendees: number; flameScale: number;
  sparksVisible: boolean; seatsOccupied: number;
}
export interface OwnedDisposable { dispose(): void }
export interface CampfireBinding {
  /** Renderer adapter must only show occupants backed by this frame. */
  render(frame: Readonly<CampfireFrame>): void;
  /** Resources exclusively owned by this instance, never shared cache resources. */
  ownedResources: readonly OwnedDisposable[];
  detach(): void;
}
export const CAMPFIRE_VISUAL = Object.freeze({
  asset: './campfire-prototype.glb',
  units: 'meters', up: 'Y', origin: 'ground-center',
  nearM: 18, midM: 60, farM: 200, snapshotTtlMs: 60_000,
  maxSeats: 8,
});
export function campfireLod(distanceM: number): CampfireLod {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 'hidden';
  return distanceM <= 18 ? 'near' : distanceM <= 60 ? 'mid' : distanceM <= 200 ? 'far' : 'hidden';
}
export function campfireFrame(placeId: string, distanceM: number, now: number, snapshot?: ArrivalSnapshot): CampfireFrame {
  const age = snapshot ? now - snapshot.observedAt : Infinity;
  const valid = Number.isFinite(now) && snapshot?.placeId === placeId &&
    typeof snapshot.receiptId === 'string' && snapshot.receiptId.trim().length > 0 &&
    Array.isArray(snapshot.arrivedMuseIds) &&
    Number.isFinite(age) && age >= 0 && age <= CAMPFIRE_VISUAL.snapshotTtlMs;
  const attendees = valid ? new Set(snapshot!.arrivedMuseIds.filter(id => typeof id === 'string' && id.trim().length > 0)).size : 0;
  const lod = campfireLod(distanceM);
  const active = attendees > 0;
  // Idle flame is ambience, never evidence of attendance. Far LOD is an icon only.
  const flicker = lod === 'near' && Number.isFinite(now) ? Math.sin(now / 217) * .055 + Math.sin(now / 383) * .025 : 0;
  return {lod, attendees, seatsOccupied: Math.min(attendees, CAMPFIRE_VISUAL.maxSeats),
    flameScale: lod === 'hidden' || lod === 'far' ? 0 : (active ? .92 : .55) + flicker,
    sparksVisible: lod === 'near' && active};
}
export function createCampfireController(placeId: string, binding: CampfireBinding) {
  if (!placeId.trim()) throw new Error('placeId required');
  let disposed = false;
  return {
    update(distanceM: number, now: number, snapshot?: ArrivalSnapshot) {
      if (disposed) return;
      binding.render(Object.freeze(campfireFrame(placeId, distanceM, now, snapshot)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { binding.detach(); }
      finally {
        // All resources must be attempted even when one renderer resource throws.
        const errors: unknown[] = [];
        for (const resource of new Set(binding.ownedResources)) {
          try { resource.dispose(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Campfire resource disposal failed');
      }
    },
  };
}
