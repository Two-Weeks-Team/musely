import type {Map as LibreMap, GeoJSONSource} from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';
import type {NeighborhoodArea} from '../engine/location.ts';

/** Catalog geometry only; never accepts device coordinates. Bounds are staged activity areas. */
export function areaGeometry(area: NeighborhoodArea | null, source = 'virtual'): FeatureCollection {
  if (!area) return {type: 'FeatureCollection', features: []};
  const {lng, lat} = area.center, ring: number[][] = [];
  for (let i = 0; i < 64; i++) {
    const a = i * 2 * Math.PI / 64;
    ring.push([lng + Math.cos(a) * area.radiusM / (111320 * Math.cos(lat * Math.PI / 180)), lat + Math.sin(a) * area.radiusM / 111320]);
  }
  ring.push([...ring[0]]);
  return {type: 'FeatureCollection', features: [
    {type: 'Feature', properties: {kind: 'area'}, geometry: {type: 'Polygon', coordinates: [ring]}},
    {type: 'Feature', properties: {kind: 'label', label: `Owner neighborhood · ${area.label}${source === 'virtual' ? ' (virtual)' : ''}`}, geometry: {type: 'Point', coordinates: [lng, lat]}},
  ]};
}

export function mountOwnerArea(map: LibreMap) {
  let current: {area?: NeighborhoodArea | null; source?: string} | null = null, visible = false;
  const paint = () => {
    const data = areaGeometry(visible ? current?.area ?? null : null, current?.source);
    const old = map.getSource('owner-neighborhood') as GeoJSONSource | undefined;
    if (old) {old.setData(data); return;}
    if (map.isStyleLoaded()) {
      map.addSource('owner-neighborhood', {type: 'geojson', data});
      map.addLayer({id: 'owner-neighborhood-fill', type: 'fill', source: 'owner-neighborhood', filter: ['==', ['get', 'kind'], 'area'], paint: {'fill-color': '#ffd98a', 'fill-opacity': .075}});
      map.addLayer({id: 'owner-neighborhood-line', type: 'line', source: 'owner-neighborhood', filter: ['==', ['get', 'kind'], 'area'], paint: {'line-color': '#ffd98a', 'line-width': 2, 'line-dasharray': [3, 2]}});
      map.addLayer({id: 'owner-neighborhood-label', type: 'symbol', source: 'owner-neighborhood', filter: ['==', ['get', 'kind'], 'label'], layout: {'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 2]}, paint: {'text-color': '#ffd98a', 'text-halo-color': '#101623', 'text-halo-width': 2}});
    }
  };
  map.on('style.load', paint);
  return {update(view: typeof current, show: boolean) {current = view; visible = show; paint();}};
}
