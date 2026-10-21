// A stand-in for Google's Maps JavaScript API in the e2e (no real key, no internet): just what our adapters call, enough
// to see that a page keeps Google's map once it is allowed (it marks its box data-fake-google-map). The loader's URL names
// its callback; the stand-in calls it as Google does.
export function fakeGoogleMapsScript(callback: string): string {
  return `(() => {
  const listener = () => ({ remove() {} });
  class LatLng { constructor(a, b) { this.a = a; this.b = b; } lat() { return this.a; } lng() { return this.b; } }
  class LatLngBounds { constructor(sw, ne) { this.sw = sw; this.ne = ne; } }
  class Map {
    constructor(div) { this.div = div; div.setAttribute('data-fake-google-map', '1'); this.z = 7; this.c = new LatLng(7.75, 80.7); }
    getDiv() { return this.div; }
    getZoom() { return this.z; } setZoom(z) { this.z = z; }
    getCenter() { return this.c; } setCenter(c) { this.c = new LatLng(c.lat, c.lng); } panTo(c) { this.setCenter(c); }
    fitBounds() {} addListener() { return listener(); } setOptions() {}
    getHeading() { return 0; } getTilt() { return 0; } setHeading() {} setTilt() {}
  }
  class Polyline { constructor() {} setMap() {} setOptions() {} setPath() {} }
  class OverlayView {
    setMap(m) { if (m) { this.map = m; this.onAdd && this.onAdd(); this.draw && this.draw(); } else { this.onRemove && this.onRemove(); this.map = null; } }
    getMap() { return this.map; }
    getPanes() { const d = this.map.getDiv(); return { overlayMouseTarget: d, overlayLayer: d, floatPane: d, markerLayer: d }; }
    getProjection() { return { fromLatLngToDivPixel: () => ({ x: 10, y: 10 }) }; }
    static preventMapHitsAndGesturesFrom() {}
  }
  window.google = { maps: { Map, LatLng, LatLngBounds, Polyline, OverlayView, importLibrary: async () => ({}),
    event: { addListenerOnce: listener, addListener: listener, clearInstanceListeners() {} } } };
  window[${JSON.stringify(callback)}]();
})();`;
}
