import {buildRoofDetails, ROOF_POLICY} from './roof-geometry.mjs';
import {radiusCheck} from './region.mjs';

export const ROOF_DETAILS_ENABLED = false;
export const ROOF_SOURCE_ID = 'musely-roof-details-experimental';
export const ROOF_LAYER_ID = 'musely-roof-details-experimental';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function nativeRoofContract(map) {
  const layer = map.getLayer('building-3d'), source = map.getSource(ROOF_POLICY.source);
  if (map.getTerrain()) return 'terrain-enabled';
  if (map.getProjection()?.type !== 'mercator') return 'unsupported-projection';
  if (!layer || layer.type !== 'fill-extrusion' || layer.source !== ROOF_POLICY.source || layer.sourceLayer !== ROOF_POLICY.sourceLayer) return 'native-layer-changed';
  if (!source || source.type !== 'vector' || source.maxzoom !== 14 || !same(source.tiles, [ROOF_POLICY.tileTemplate])) return 'source-version-changed';
  if (map.getLayoutProperty('building-3d', 'visibility') === 'none') return 'native-layer-hidden';
  if (!same(map.getPaintProperty('building-3d', 'fill-extrusion-height'), ['get', 'render_height']) || !same(map.getPaintProperty('building-3d', 'fill-extrusion-base'), ['get', 'render_min_height'])) return 'native-height-expression-changed';
  if (!same(map.getFilter('building-3d'), ['!', ['has', 'hide_3d']])) return 'native-filter-changed';
  if ((map.getPaintProperty('building-3d', 'fill-extrusion-opacity') ?? 1) !== 1 || !same(map.getPaintProperty('building-3d', 'fill-extrusion-translate') ?? [0,0], [0,0]) || (map.getLayoutProperty('building-3d','fill-extrusion-rounded-corner-distance') ?? 0) !== 0) return 'native-geometry-or-opacity-changed';
  if (layer.minzoom !== 14 || (layer.maxzoom !== undefined && layer.maxzoom < 24)) return 'native-zoom-contract-changed';
  if (map.getZoom() < ROOF_POLICY.minZoom) return 'below-detail-zoom';
  if (map.isMoving()) return 'camera-moving';
  if (!map.isSourceLoaded(ROOF_POLICY.source)) return 'native-tiles-pending';
  return null;
}

/** Isolated opt-in seam. Uses the map's current native features, not the static
 * regional asset. No fetch, no native property edits, no terrain approximation.
 * Source/style/terrain changes hide the owned layer before rebuilding on idle.
 */
export function createNativeRoofDetails(map, {enabled = false, radius = 500} = {}) {
  radiusCheck(radius);
  let requested = false, active = false, disposed = false, busy = false;
  let ownedSource = null, ownedLayer = null, pending = false, last = null;
  let reason = 'disabled';
  const conflicts = [];
  function ownsLayer() { return ownedLayer && map.getLayer(ROOF_LAYER_ID) === ownedLayer; }
  function hide(why) {
    reason = why; active = false;
    if (ownsLayer() && map.getLayoutProperty(ROOF_LAYER_ID, 'visibility') !== 'none') map.setLayoutProperty(ROOF_LAYER_ID, 'visibility', 'none');
  }
  function removeOwned() {
    if (ownedLayer) {
      if (ownsLayer()) map.removeLayer(ROOF_LAYER_ID);
      else if (map.getLayer(ROOF_LAYER_ID)) conflicts.push('layer-ownership-changed');
    }
    if (ownedSource) {
      if (map.getSource(ROOF_SOURCE_ID) === ownedSource && !map.getLayer(ROOF_LAYER_ID)) map.removeSource(ROOF_SOURCE_ID);
      else if (map.getSource(ROOF_SOURCE_ID)) conflicts.push('source-ownership-changed');
    }
    ownedLayer = null; ownedSource = null;
  }
  function refresh() {
    if (!requested || disposed || busy) return status();
    busy = true;
    try {
      const blocked = nativeRoofContract(map);
      if (blocked) { hide(blocked); pending = true; return status(); }
      if ((map.getSource(ROOF_SOURCE_ID) && map.getSource(ROOF_SOURCE_ID) !== ownedSource) || (map.getLayer(ROOF_LAYER_ID) && !ownsLayer())) { hide('identifier-occupied'); requested = false; return status(); }
      const nativeFeatures = map.querySourceFeatures(ROOF_POLICY.source, {sourceLayer:ROOF_POLICY.sourceLayer});
      const collection = buildRoofDetails(nativeFeatures, {radius});
      const {report, ...data} = collection; last = report;
      hide('refreshing');
      // Replace the small owned source instead of setData: old GPU buckets can
      // never be made visible while a newer asynchronous worker update is pending.
      removeOwned();
      if (!data.features.length) { reason = 'no-admitted-roofs'; pending = false; return status(); }
      map.addSource(ROOF_SOURCE_ID, {type:'geojson', data, maxzoom:22, tolerance:0, buffer:64});
      ownedSource = map.getSource(ROOF_SOURCE_ID);
      map.addLayer({id:ROOF_LAYER_ID, type:'fill-extrusion', source:ROOF_SOURCE_ID, minzoom:ROOF_POLICY.minZoom,
        layout:{visibility:'none'}, paint:{'fill-extrusion-color':['get','color'], 'fill-extrusion-base':['get','base'], 'fill-extrusion-height':['get','top'], 'fill-extrusion-opacity':1, 'fill-extrusion-vertical-gradient':true}}, map.getLayer('musely-world') ? 'musely-world' : undefined);
      ownedLayer = map.getLayer(ROOF_LAYER_ID);
      pending = false; reason = 'detail-tiles-pending';
      // The next idle reveals only this fresh source. Hidden sources need not
      // have GPU tiles yet; a further idle confirms the visible source is loaded.
      return status();
    } catch (error) {
      try { hide('error'); removeOwned(); } catch { conflicts.push('cleanup-failed'); }
      requested = false; pending = false; reason = String(error.message || error);
      return status();
    } finally { busy = false; }
  }
  function onIdle() {
    if (!requested || disposed || busy) return;
    const blocked = nativeRoofContract(map);
    if (blocked) { hide(blocked); return; }
    if (pending) { refresh(); return; }
    if (ownsLayer() && map.getSource(ROOF_SOURCE_ID) === ownedSource && map.isSourceLoaded(ROOF_SOURCE_ID)) {
      if (map.getLayoutProperty(ROOF_LAYER_ID, 'visibility') === 'none') { busy = true; try { map.setLayoutProperty(ROOF_LAYER_ID, 'visibility', 'visible'); reason = 'detail-render-pending'; } finally { busy = false; } }
      else { active = true; reason = 'active'; }
    }
  }
  function onNativeLoading(e) {
    if (requested && !busy && e.sourceId === ROOF_POLICY.source) { pending = true; hide('native-tiles-changing'); }
  }
  function onStyleData() {
    if (!requested || busy) return;
    const blocked = nativeRoofContract(map);
    if (blocked) { pending = true; hide(blocked); }
  }
  function onZoom() {
    if (!requested) return;
    if (map.getZoom() < ROOF_POLICY.minZoom) { pending = true; hide('below-detail-zoom'); }
  }
  function onMove() { if (requested) { pending = true; hide('camera-moving'); } }
  function onSourceError(e) {
    if (requested && (!e.sourceId || e.sourceId === ROOF_POLICY.source || e.sourceId === ROOF_SOURCE_ID)) { pending = false; requested = false; hide('tile-error-explicit-reenable-required'); }
  }
  function onStyleLoad() { hide('style-reloaded-explicit-reenable-required'); requested = false; pending = false; removeOwned(); }
  function onRemove() { requested = false; active = false; disposed = true; pending = false; ownedLayer = null; ownedSource = null; reason = 'map-removed'; for (const [event,listener] of Object.entries(listeners)) map.off(event,listener); }
  const listeners = {idle:onIdle, sourcedataloading:onNativeLoading, sourcedata:onNativeLoading, styledata:onStyleData, terrain:onStyleData, projectiontransition:onStyleData, zoom:onZoom, movestart:onMove, moveend:onMove, error:onSourceError, 'style.load':onStyleLoad, remove:onRemove};
  for (const [event, listener] of Object.entries(listeners)) map.on(event, listener);
  function status() { return {enabled:requested, active, reason, report:last, conflicts:[...conflicts]}; }
  function disable() { requested = false; pending = false; hide('disabled'); removeOwned(); return status(); }
  const controller = {
    get active() { return active; }, status,
    enable() { if (disposed) throw Error('Roof controller disposed'); if (requested) return status(); requested = true; pending = true; return refresh(); },
    refresh, disable,
    dispose() { if (!disposed) { disable(); for (const [event, listener] of Object.entries(listeners)) map.off(event, listener); disposed = true; } return status(); },
  };
  if (enabled) controller.enable();
  return controller;
}
