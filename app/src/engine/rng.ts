// Deterministic randomness for the scenario engine (direction v2, 8.1): every choice derives from
// the day seed plus stable keys (tick, Muse, purpose), so a day replays identically and is testable.
export function hash32(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  // final avalanche (murmur3 fmix)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (seed: string, ...keys: (string | number)[]) => mulberry32(hash32([seed, ...keys].join('|')));

export function weightedPick<T>(rand: () => number, items: readonly T[], weight: (t: T) => number): T | null {
  const ws = items.map(w => Math.max(0, weight(w)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

/** Seed for a world day in the commons' local time (America/Los_Angeles). */
export function daySeed(worldId: string, localDate: string) { return `${worldId}:${localDate}`; }
