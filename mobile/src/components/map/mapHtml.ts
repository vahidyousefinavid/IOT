import { colors } from '@/theme/tokens';

/**
 * Tile server. OpenStreetMap's public tiles are for light use only; in
 * production point EXPO_PUBLIC_MAP_TILES at your own tile server or an
 * Iranian provider (Neshan, Map.ir), e.g. https://tiles.example.com/{z}/{x}/{y}.png
 */
const TILES = process.env.EXPO_PUBLIC_MAP_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? '© OpenStreetMap';

export interface MapData {
  /** Current position, if known. */
  pos: [number, number] | null;
  course: number;
  moving: boolean;
  /** Route as [lat, lon] pairs, oldest first. */
  track: [number, number][];
}

/**
 * Self-contained Leaflet page. The host calls window.update(data) (native,
 * via injectJavaScript) or posts {type:'update', data} (web iframe).
 */
export const mapHtml = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; background: ${colors.bg}; }
  /* Dark map from standard tiles */
  .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(0.6); }
  .leaflet-control-attribution { background: rgba(10,12,16,.6) !important; color: #888; font-size: 9px; }
  .leaflet-control-attribution a { color: #aaa; }
  .car { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
         background: ${colors.sky}; box-shadow: 0 0 0 6px rgba(108,184,255,.25), 0 4px 14px rgba(0,0,0,.5); }
  .car.moving { background: ${colors.amber}; box-shadow: 0 0 0 8px rgba(255,181,71,.25), 0 4px 14px rgba(0,0,0,.5); }
  .car svg { transition: transform .4s; }
</style></head>
<body><div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([35.7, 51.4], 11);
  L.tileLayer(${JSON.stringify(TILES)}, { maxZoom: 19, attribution: ${JSON.stringify(ATTRIBUTION)} }).addTo(map);
  var route = L.polyline([], { color: '${colors.sky}', weight: 4, opacity: .85 }).addTo(map);
  var marker = null, first = true;
  function icon(course, moving) {
    return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
      html: '<div class="car' + (moving ? ' moving' : '') + '"><svg width="16" height="16" viewBox="0 0 24 24" style="transform: rotate(' + course + 'deg)"><path d="M12 2 L19 21 L12 17 L5 21 Z" fill="${colors.bg}"/></svg></div>' });
  }
  window.update = function (d) {
    route.setLatLngs(d.track || []);
    if (d.pos) {
      if (!marker) marker = L.marker(d.pos, { icon: icon(d.course, d.moving) }).addTo(map);
      else { marker.setLatLng(d.pos); marker.setIcon(icon(d.course, d.moving)); }
    }
    if (first) {
      first = false;
      if (d.track && d.track.length > 1) map.fitBounds(route.getBounds(), { padding: [40, 40] });
      else if (d.pos) map.setView(d.pos, 15);
    } else if (d.pos && !map.getBounds().pad(-0.2).contains(d.pos)) {
      map.panTo(d.pos);
    }
  };
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'update') window.update(e.data.data);
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'map-ready' }, '*');
</script></body></html>`;
