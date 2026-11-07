import L from 'leaflet';
import { gsap } from 'gsap';
import type { LatLngTuple, MapManifest, Place, Zone } from '../types';
import { zoneAt, zoneCoords } from '../game/geo';
import { guessPinSvg, targetPinSvg } from '../ui/icons';
import { TerrainLayer } from './terrain';

export type MapStyle = 'auto' | 'parchment' | 'terrain';

export interface HoverInfo { zone: string | null; coords: [number, number] | null; }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pins & flags are drawn at 40×48 and shown at 70%. */
const PIN_SIZE: [number, number] = [28, 34];

const pinIcon = (cls: string, html: string, size: [number, number], anchor: [number, number], label = '') =>
  L.divIcon({ className: `pin ${cls}`, html: `${html}${label ? `<span class="pin__label">${label}</span>` : ''}`, iconSize: size, iconAnchor: anchor });

const guessIcon = (label = '') => pinIcon('pin--guess', `<span class="pin__shadow"></span>${guessPinSvg}`, PIN_SIZE, [14, 33], label);
const targetIcon = (label = '') => pinIcon('pin--target', `<span class="pin__ring"></span><span class="pin__ring pin__ring--2"></span>${targetPinSvg}`, PIN_SIZE, [6, 33], label);

/** Keep the parchment's top edge clear of the title bar. */
const HOME_PADDING: L.FitBoundsOptions = { paddingTopLeft: [8, 58], paddingBottomRight: [8, 4] };

export class MapView {
  readonly map: L.Map;
  private readonly manifest: MapManifest;
  private readonly zones: Record<string, Zone>;
  private parchment!: L.ImageOverlay;
  private style: MapStyle = 'auto';
  private fitZoom = 2;
  private guess: L.Marker | null = null;
  private readonly roundLayer = L.layerGroup();
  private readonly hoverOutline: L.Polygon;
  private showZoneOutline = true;
  private hoverRaf = 0;
  /** True while an answer is on screen – no hover outlines then. */
  private locked = false;

  onPick: ((latlng: LatLngTuple) => void) | null = null;
  onHover: ((info: HoverInfo) => void) | null = null;

  constructor(el: HTMLElement, manifest: MapManifest, zones: Record<string, Zone>) {
    this.manifest = manifest;
    this.zones = zones;
    const [[s, w], [n, e]] = manifest.worldBounds;
    const pad = 30;
    this.map = L.map(el, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 110,
      maxBounds: [[s - pad, w - pad], [n + pad, e + pad]],
      maxBoundsViscosity: 0.85,
      maxZoom: 8,
      inertia: true,
      doubleClickZoom: false,
      fadeAnimation: true,
    });
    this.map.attributionControl.setPrefix(false).addAttribution(
      'Map imagery: <a href="https://wowforever.gg/en/atlas/" target="_blank" rel="noopener">wowforever.gg Azeroth Atlas</a> · World of Warcraft © Blizzard Entertainment',
    );

    for (const [name, z] of [['ocean', 150], ['terrain', 200], ['parchment', 250], ['zones', 390]] as const) {
      this.map.createPane(name).style.zIndex = String(z);
    }
    this.map.getPane('zones')!.style.pointerEvents = 'none';

    L.imageOverlay('/map/ocean.webp', manifest.oceanBounds, { pane: 'ocean', className: 'ocean-layer', interactive: false }).addTo(this.map);
    new TerrainLayer(manifest.tiles, '/map/tiles', manifest.maxNativeZoom, { pane: 'terrain', bounds: manifest.worldBounds }).addTo(this.map);
    this.parchment = L.imageOverlay('/map/overview.webp', manifest.overviewBounds, { pane: 'parchment', className: 'parchment-layer', interactive: false }).addTo(this.map);
    this.hoverOutline = L.polygon([], { pane: 'zones', className: 'zone-hover', interactive: false });
    this.roundLayer.addTo(this.map);

    this.updateFit();
    this.map.fitBounds(manifest.overviewBounds, { animate: false, ...HOME_PADDING });
    this.map.on('resize', () => this.updateFit());
    this.map.on('zoomanim', (ev: L.ZoomAnimEvent) => this.applyStyle(ev.zoom));
    this.map.on('zoomend', () => this.applyStyle());
    this.map.on('click', (ev: L.LeafletMouseEvent) => this.onPick?.([ev.latlng.lat, ev.latlng.lng]));
    this.map.on('mousemove', (ev: L.LeafletMouseEvent) => this.hover([ev.latlng.lat, ev.latlng.lng]));
    this.map.on('mouseout', () => { this.hoverOutline.remove(); this.onHover?.({ zone: null, coords: null }); });
  }

  /** Resolves once the parchment (the first thing players see) has loaded. */
  ready(): Promise<void> {
    const img = this.parchment.getElement() as HTMLImageElement | undefined;
    if (!img || img.complete) return Promise.resolve();
    return new Promise((resolve, reject) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => reject(new Error('Could not load the world map.')), { once: true });
    });
  }

  private updateFit() {
    this.fitZoom = this.map.getBoundsZoom(this.manifest.overviewBounds, false);
    this.map.setMinZoom(Math.floor((this.fitZoom - 0.5) * 4) / 4);
    this.applyStyle();
  }

  setStyle(style: MapStyle) { this.style = style; this.applyStyle(); }
  setZoneOutline(on: boolean) { this.showZoneOutline = on; if (!on) this.hoverOutline.remove(); }

  /** Parchment at world view, cross-fading into the terrain as you zoom in. */
  private applyStyle(zoom = this.map.getZoom()) {
    let opacity = 1;
    if (this.style === 'terrain') opacity = 0;
    else if (this.style === 'auto') opacity = 1 - Math.min(1, Math.max(0, (zoom - (this.fitZoom + 0.7)) / 1.1));
    const el = this.parchment.getElement();
    if (el) el.style.opacity = String(opacity);
    this.map.getContainer().classList.toggle('is-terrain', opacity < 0.5);
  }

  private hover(p: LatLngTuple) {
    cancelAnimationFrame(this.hoverRaf);
    this.hoverRaf = requestAnimationFrame(() => {
      const hit = zoneAt(p, this.zones);
      if (!hit) { this.hoverOutline.remove(); this.onHover?.({ zone: null, coords: null }); return; }
      const [id, zone] = hit;
      const outline = this.showZoneOutline && !this.locked;
      if (!outline) this.hoverOutline.remove();
      if (outline && (this.hoverOutline as L.Polygon & { _zoneId?: string })._zoneId !== id) {
        this.hoverOutline.setLatLngs(zone.rings);
        (this.hoverOutline as L.Polygon & { _zoneId?: string })._zoneId = id;
      }
      if (outline && !this.map.hasLayer(this.hoverOutline)) this.hoverOutline.addTo(this.map);
      this.onHover?.({ zone: zone.name, coords: zoneCoords(p, zone) });
    });
  }

  // ------------------------------------------------------------ rounds ----
  placeGuess(p: LatLngTuple) {
    if (this.guess) {
      this.guess.setLatLng(p);
      const el = this.guess.getElement();
      el?.classList.remove('is-dropping');
      void el?.offsetWidth;
      el?.classList.add('is-dropping');
      return;
    }
    this.guess = L.marker(p, { icon: guessIcon(), draggable: true, keyboard: false, riseOnHover: true, zIndexOffset: 1000 }).addTo(this.roundLayer);
    this.guess.getElement()?.classList.add('is-dropping');
    this.guess.on('dragend', () => {
      const ll = this.guess!.getLatLng();
      this.onPick?.([ll.lat, ll.lng]);
    });
  }

  clearRound() {
    this.locked = false;
    this.roundLayer.clearLayers();
    this.guess = null;
  }

  /** Animate the answer: fly to fit, draw the line, raise the flag. */
  async reveal(guess: LatLngTuple, anchor: LatLngTuple, place: Place, distanceLabel: string): Promise<void> {
    this.locked = true;
    this.hoverOutline.remove();
    this.guess?.dragging?.disable();
    this.guess?.getElement()?.classList.add('is-locked');
    const area = place.area ? this.zones[place.area] : undefined;
    const points: LatLngTuple[] = [guess, anchor, place.latlng];
    const bounds = L.latLngBounds(area ? [...points, ...area.rings.flat()] : points);
    await this.flyTo(bounds, 5.25);

    if (area) {
      const poly = L.polygon(area.rings, { className: 'zone-target', interactive: false }).addTo(this.roundLayer);
      gsap.fromTo(poly.getElement()!, { opacity: 0 }, { opacity: 1, duration: 0.6 });
    }
    const line = L.polyline([guess, guess], { className: 'reveal-line', interactive: false }).addTo(this.roundLayer);
    const glow = L.polyline([guess, guess], { className: 'reveal-line-glow', interactive: false }).addTo(this.roundLayer);
    glow.bringToBack();
    const progress = { t: reducedMotion() ? 1 : 0 };
    await new Promise<void>(resolve =>
      gsap.to(progress, {
        t: 1,
        duration: 0.9,
        ease: 'power2.inOut',
        onUpdate: () => {
          const p: LatLngTuple = [guess[0] + (anchor[0] - guess[0]) * progress.t, guess[1] + (anchor[1] - guess[1]) * progress.t];
          line.setLatLngs([guess, p]);
          glow.setLatLngs([guess, p]);
        },
        onComplete: resolve,
      }),
    );
    const onScreen = this.map.latLngToContainerPoint(guess).distanceTo(this.map.latLngToContainerPoint(anchor));
    // Short lines: the label would cover the flag – the card shows the distance anyway.
    if (distanceLabel && onScreen > 150) {
      line.bindTooltip(distanceLabel, { permanent: true, direction: 'center', className: 'distance-tip' }).openTooltip(
        L.latLng((guess[0] + anchor[0]) / 2, (guess[1] + anchor[1]) / 2),
      );
    }
    const flag = L.marker(place.latlng, { icon: targetIcon(), keyboard: false, interactive: false, zIndexOffset: 900 }).addTo(this.roundLayer);
    flag.getElement()?.classList.add('is-rising');
  }

  /** Draw every round of a finished game. */
  showSummary(rounds: { guess: LatLngTuple; anchor: LatLngTuple; place: Place }[]) {
    this.clearRound();
    this.locked = true;
    const pts: LatLngTuple[] = [];
    rounds.forEach((r, i) => {
      const area = r.place.area ? this.zones[r.place.area] : undefined;
      if (area) L.polygon(area.rings, { className: 'zone-target zone-target--quiet', interactive: false }).addTo(this.roundLayer);
      L.polyline([r.guess, r.anchor], { className: 'reveal-line reveal-line--static', interactive: false }).addTo(this.roundLayer);
      L.marker(r.guess, { icon: guessIcon(String(i + 1)), keyboard: false, interactive: false }).addTo(this.roundLayer);
      L.marker(r.place.latlng, { icon: targetIcon(), keyboard: false, title: r.place.name })
        .bindTooltip(`${i + 1}. ${r.place.name}`, { direction: 'top', offset: [8, -31], className: 'place-tip' })
        .addTo(this.roundLayer);
      pts.push(r.guess, r.place.latlng);
    });
    void this.flyTo(L.latLngBounds(pts), 4);
  }

  flyTo(bounds: L.LatLngBounds, maxZoom: number): Promise<void> {
    const mobile = window.innerWidth < 720;
    const options: L.FitBoundsOptions = {
      paddingTopLeft: [mobile ? 40 : 90, mobile ? 90 : 110],
      paddingBottomRight: [mobile ? 40 : 90, mobile ? 300 : 250],
      maxZoom,
    };
    if (reducedMotion()) { this.map.fitBounds(bounds, options); return Promise.resolve(); }
    return new Promise(resolve => {
      this.map.once('moveend', () => resolve());
      this.map.flyToBounds(bounds, { ...options, duration: 1.1, easeLinearity: 0.2 });
      // flyToBounds is a no-op (no moveend) when already there
      setTimeout(resolve, 1600);
    });
  }

  home(animate = true) {
    if (animate && !reducedMotion()) this.map.flyToBounds(this.manifest.overviewBounds, { duration: 1, ...HOME_PADDING });
    else this.map.fitBounds(this.manifest.overviewBounds, { animate: false, ...HOME_PADDING });
  }

  focusContinent(continent: string) {
    const pts = Object.values(this.zones).filter(z => z.continent === continent).flatMap(z => z.bounds);
    if (pts.length) void this.flyTo(L.latLngBounds(pts), 3.5);
  }

  zoomBy(delta: number) { this.map.setZoom(this.map.getZoom() + delta); }
}
