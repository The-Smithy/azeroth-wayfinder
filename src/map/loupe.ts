import L from 'leaflet';
import type { LatLngTuple, MapManifest } from '../types';
import { TerrainLayer } from './terrain';

/** How much closer the loupe looks than the map underneath (zoom levels). */
const MAGNIFY = 2;
/** Past the sharpest tiles it only gets blurrier, so stop one level beyond them. */
const BEYOND_NATIVE = 1;
/** Loupe diameter (CSS px) and how far above the finger it floats. */
const SIZE = 132;
const LIFT = 96;

/**
 * A magnifying glass for touch screens: while a finger drags the pin, a round, zoomed-in view
 * of the terrain under the pin's tip floats above the finger, with a crosshair on the exact
 * point that will be guessed. Built lazily on first use, so desktop never loads it.
 */
export class Loupe {
  private readonly host: HTMLElement;
  private readonly manifest: MapManifest;
  private el: HTMLDivElement | null = null;
  private lens: L.Map | null = null;

  constructor(host: HTMLElement, manifest: MapManifest) {
    this.host = host;
    this.manifest = manifest;
  }

  private build() {
    const el = document.createElement('div');
    el.className = 'loupe';
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--loupe-size', `${SIZE}px`);
    el.innerHTML = '<div class="loupe__map"></div><span class="loupe__cross"></span>';
    this.host.appendChild(el);
    const lens = L.map(el.firstElementChild as HTMLElement, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomSnap: 0,
      fadeAnimation: false,
      zoomAnimation: false,
      maxZoom: 9,
    });
    // The sea sits under the terrain tiles (the default overlay pane would cover them).
    lens.createPane('ocean').style.zIndex = '150';
    L.imageOverlay('/map/ocean.webp', this.manifest.oceanBounds, { pane: 'ocean', interactive: false }).addTo(lens);
    new TerrainLayer(this.manifest.tiles, '/map/tiles', this.manifest.maxNativeZoom, { bounds: this.manifest.worldBounds }).addTo(lens);
    this.el = el;
    this.lens = lens;
  }

  /**
   * Show the loupe for the point `at`, whose pin tip is drawn at `screen` (container px).
   * It floats above the finger, or below it near the top edge, and stays inside the map.
   */
  show(at: LatLngTuple, screen: L.Point, zoom: number) {
    if (!this.el) this.build();
    const el = this.el!, lens = this.lens!;
    const { clientWidth: w } = this.host;
    const half = SIZE / 2;
    const above = screen.y - LIFT - SIZE > 8;
    const x = Math.min(Math.max(screen.x - half, 8), w - SIZE - 8);
    const y = above ? screen.y - LIFT - SIZE : screen.y + LIFT / 2;
    el.style.transform = `translate(${x}px, ${y}px)`;
    if (!el.classList.contains('is-on')) {
      el.classList.add('is-on');
      lens.invalidateSize({ pan: false });
    }
    lens.setView(at, Math.min(zoom + MAGNIFY, this.manifest.maxNativeZoom + BEYOND_NATIVE), { animate: false });
  }

  hide() {
    this.el?.classList.remove('is-on');
  }
}

/** True on phones and tablets, where a finger hides whatever it is touching. */
export const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;
