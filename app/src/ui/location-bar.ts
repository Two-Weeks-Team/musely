import {uiText} from './i18n.ts';
// Owner location in the page (direction v2, 13.1): the always-on header chip and the device location card of the Location tab.
// The wording and the state transitions live in location-state.ts (no DOM); this file only paints them. Everything is textContent.
import {locationLine, snapshotOf, deviceLocation, deviceText, type LocationSnapshot, type OwnerLocationView, type DeviceLocation, type LocationName} from './location-state';
import {PRESETS, type PresetId} from '../engine/location.ts';
import {BLOCKED, type Fetched} from './resource-state';

/**
 * The header chip: "Virtual neighborhood" for as long as the virtual source is used, the owner's destination, and the Muse's own
 * current place with its trip and ETA. It is shown in every mode (story and world). The panel's refresh feeds it the
 * /api/owner/location answers; it counts the ETA down by itself between them.
 */
export function mountLocationChip(header: HTMLElement, before: Element | null, nameOf?: LocationName) {
  const chip = document.createElement('span');
  chip.className = 'loc-chip'; chip.id = 'loc-chip';
  header.insertBefore(chip, before);
  let snap: LocationSnapshot | null = null, error: string | null = null, shown = '';
  const paint = () => {
    const l = locationLine(snap, Date.now(), error, nameOf);
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

let permissionState: PermissionState | 'unknown' | 'checking' = 'unknown', permissionQueryStarted = false;
let viewNeighborhood: ((id: PresetId) => void) | undefined, virtualChoice: PresetId = 'hq';

/** Device-only mapping. A permission query never opens a prompt; prompt/unknown still needs an explicit click. */
export function deviceLocationCard(onView?: (id: PresetId) => void) {
  viewNeighborhood = onView;
  const card = document.createElement('div'); card.className = 'device-loc'; card.id = 'device-location';
  const heading = document.createElement('strong');
  const why = document.createElement('p'); why.textContent = uiText('가까운 동네를 지도에서 보여드리려고 위치를 확인해요. / Location helps show your nearby neighborhood on the map.');
  const detail = document.createElement('p'); detail.className = 'muted'; detail.setAttribute('role', 'status');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.id = 'device-location-request';
  const virtual = document.createElement('div'); virtual.id = 'device-location-alternative';
  const label = document.createElement('label'); label.className = 'fld'; label.textContent = uiText('둘러볼 가상 동네 / Virtual neighborhood to explore');
  const select = document.createElement('select'); select.id = 'device-location-virtual'; select.setAttribute('aria-label', label.textContent);
  for (const p of PRESETS) { const option = document.createElement('option'); option.value = p.id; option.textContent = p.label; select.append(option); }
  select.value = virtualChoice; select.onchange = () => { const p = PRESETS.find(p => p.id === select.value); if (p) virtualChoice = p.id; };
  label.append(select);
  const view = document.createElement('button'); view.type = 'button'; view.className = 'secondary'; view.id = 'device-location-view'; view.textContent = uiText('이 동네 둘러보기 / Explore this neighborhood');
  const viewed = document.createElement('p'); viewed.className = 'muted'; viewed.setAttribute('role', 'status');
  view.onclick = () => { const p = PRESETS.find(p => p.id === select.value); if (!p) return; virtualChoice = p.id; viewNeighborhood?.(p.id); viewed.textContent = uiText`${p.label} 가상 동네를 보고 있어요. / Viewing ${p.label} virtually.`; };
  virtual.append(label, view, viewed);
  const help = document.createElement('details'), summary = document.createElement('summary'), recovery = document.createElement('p');
  summary.textContent = uiText('위치 설정 도움말 / Location settings help'); help.append(summary, recovery);
  const paint = (d: DeviceLocation) => {
    const t = deviceText(d);
    heading.textContent = t.heading; detail.textContent = t.detail;
    const denied = permissionState === 'denied' || d.status === 'denied';
    const chrome = typeof navigator !== 'undefined' && /(?:Chrome|Chromium)\//.test(navigator.userAgent) && !/(?:Edg|OPR)\//.test(navigator.userAgent);
    recovery.textContent = chrome
      ? uiText('Chrome: 주소 옆 사이트 정보 → 사이트 설정 → 위치에서 차단을 재설정하거나 허용한 뒤 돌아오세요. / In Chrome, open the site information icon beside the address, then Site settings → Location. Reset the blocked permission or allow it, then return here.')
      : uiText('이 브라우저의 사이트 설정에서 위치 권한을 확인한 뒤 돌아오세요. / Review Location permission in this browser’s site settings, then return here.');
    help.hidden = !denied;
    card.dataset.status = d.status; card.dataset.fallback = t.fallback ? '1' : ''; card.dataset.permission = permissionState;
    button.hidden = denied || t.fallback || d.status === 'near' || permissionState === 'granted';
    button.disabled = d.status === 'requesting' || permissionState === 'checking';
    button.textContent = permissionState === 'checking' ? uiText('위치 설정 확인 중… / Checking location settings…') : d.status === 'requesting' ? uiText('동네 찾는 중… / Finding neighborhood…') : uiText('내 동네 찾기 / Find my neighborhood');
    virtual.hidden = !t.fallback;
  };
  const geo = typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : undefined;
  flow ??= deviceLocation(geo, d => { paintCard?.(d); if (d.status === 'near' && d.preset) viewNeighborhood?.(d.preset); });
  paintCard = paint;
  const f = flow;
  button.onclick = () => { if (!button.disabled && !button.hidden && permissionState !== 'denied') f.request(); };
  card.append(heading, why, detail, button, virtual, help);
  if (!permissionQueryStarted) {
    permissionQueryStarted = true;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      permissionState = 'checking';
      void (async () => {
        try {
          const status = await navigator.permissions.query({name: 'geolocation'});
          const update = () => {
            if (!['prompt', 'denied', 'granted'].includes(status.state)) return;
            const changed = permissionState !== status.state;
            permissionState = status.state; f.permission(status.state); paintCard?.(f.state);
            if (changed && status.state === 'granted') f.request();
          };
          status.addEventListener('change', update); update();
        } catch { permissionState = 'unknown'; paintCard?.(f.state); }
      })();
    }
  }
  paint(f.state);
  return card;
}
