// Owner location in the page (direction v2, 13.1): the always-on header chip and the device location card of the Location tab.
// The wording and the state transitions live in location-state.ts (no DOM); this file only paints them. Everything is textContent.
import {locationLine, snapshotOf, deviceLocation, deviceText, type LocationSnapshot, type OwnerLocationView, type DeviceLocation} from './location-state';
import {BLOCKED, type Fetched} from './resource-state';

/**
 * The header chip: "Virtual location (demo)" for as long as the virtual source is used, the owner's destination, and the Muse's own
 * current place with its trip and ETA. It is shown in every mode (story and world). The panel's refresh feeds it the
 * /api/owner/location answers; it counts the ETA down by itself between them.
 */
export function mountLocationChip(header: HTMLElement, before: Element | null) {
  const chip = document.createElement('span');
  chip.className = 'loc-chip'; chip.id = 'loc-chip';
  header.insertBefore(chip, before);
  let snap: LocationSnapshot | null = null, error: string | null = null, shown = '';
  const paint = () => {
    const l = locationLine(snap, Date.now(), error);
    if (l.text !== shown) { shown = l.text; chip.textContent = l.text; }
    chip.title = l.title; chip.dataset.state = l.state; chip.dataset.stale = l.stale ? '1' : '';
  };
  paint();
  setInterval(paint, 1000);
  return {
    /** One answer from GET /api/owner/location. A request the replay refused changes nothing. */
    update(r: Fetched<OwnerLocationView>) {
      if (!r.ok && r.error === BLOCKED) return;
      if (r.ok) { snap = snapshotOf(r.data, r.at); error = null; } else error = r.error;
      paint();
    },
    get snapshot() { return snap; },
  };
}

// One flow per page: the Location tab is rebuilt on every render, and the answer must survive that (only the latest card is painted).
let flow: ReturnType<typeof deviceLocation> | null = null, paintCard: ((d: DeviceLocation) => void) | null = null;

/** The device location card (Location tab): one button, the state it reached, and the virtual-location guidance on refusal or failure. */
export function deviceLocationCard() {
  const card = document.createElement('div'); card.className = 'device-loc'; card.id = 'device-location';
  const heading = document.createElement('strong');
  const detail = document.createElement('p'); detail.className = 'muted'; detail.setAttribute('role', 'status');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.id = 'device-location-request';
  const paint = (d: DeviceLocation) => {
    const t = deviceText(d);
    heading.textContent = t.heading; detail.textContent = t.detail;
    card.dataset.status = d.status; card.dataset.fallback = t.fallback ? '1' : '';
    button.disabled = d.status === 'requesting';
    button.textContent = d.status === 'idle' ? 'Use device location (GPS)' : 'Ask again';
  };
  const geo = typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : undefined;
  flow ??= deviceLocation(geo, d => paintCard?.(d));
  paintCard = paint;
  const f = flow;
  button.onclick = () => f.request();
  paint(f.state);
  card.append(heading, detail, button);
  return card;
}
