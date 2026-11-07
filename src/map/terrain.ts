import L from 'leaflet';

/**
 * Terrain pyramid renderer. Tiles live at /map/tiles/{z}/{x}/{y}.webp in Leaflet
 * CRS.Simple space (zoom z = 2^z px per world unit). The pyramid is sparse – open
 * sea has no tiles – and some deep tiles are missing, so each tile falls back to
 * the matching quadrant of its nearest existing ancestor.
 */
export class TerrainLayer extends L.GridLayer {
  private readonly keys: Set<string>;
  private readonly base: string;
  private readonly native: number;
  private readonly images = new Map<string, Promise<HTMLImageElement>>();

  constructor(keys: string[], base: string, maxNativeZoom: number, options: L.GridLayerOptions = {}) {
    super({ tileSize: 512, minNativeZoom: 0, maxNativeZoom, noWrap: true, keepBuffer: 3, updateWhenZooming: false, ...options });
    this.keys = new Set(keys);
    this.base = base;
    this.native = maxNativeZoom;
  }

  private image(key: string): Promise<HTMLImageElement> {
    let p = this.images.get(key);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => { this.images.delete(key); reject(new Error(`tile ${key}`)); };
        img.src = `${this.base}/${key}.webp`;
      });
      this.images.set(key, p);
    }
    return p;
  }

  protected createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    for (let level = Math.min(coords.z, this.native); level >= 0; level--) {
      const f = 2 ** (coords.z - level);
      const px = Math.floor(coords.x / f), py = Math.floor(coords.y / f);
      const key = `${level}/${px}/${py}`;
      if (!this.keys.has(key)) continue;
      const size = 512 / f, sx = (coords.x - px * f) * size, sy = (coords.y - py * f) * size;
      this.image(key)
        .then(img => {
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 512, 512);
          done(undefined, canvas);
        })
        .catch(err => done(err, canvas));
      return canvas;
    }
    queueMicrotask(() => done(undefined, canvas)); // open sea
    return canvas;
  }
}
