# Azeroth Pinpoint 📍

A daily World of Warcraft geography game. Every day you get **five places in Azeroth**
(a capital or zone, three settlements and a dungeon entrance) and drop a pin on the
**WoW: Forever** world map as close as you can. Each pin scores up to 100 for accuracy,
and the stakes rise: locations 1–2 count ×1, location 3 ×2 and locations 4–5 ×3, so a
perfect day is **1,000 points**. Same puzzle for everyone, with a shareable emoji result:

```
Azeroth Pinpoint #4 📍 635/1,000
🎯🟩🟨🟥🎯
```

## Features

- **Map that feels like the game:** the in-game parchment world map at world view
  cross-fades into the full terrain (minimap imagery, 7 zoom levels) as you zoom in.
  It sits over an animated illustrated ocean, with a shallow-water glow on the coasts,
  drifting clouds, embers and a vignette.
- **Zone hover HUD:** shows the zone name, its outline and in-game style `x, y`
  coordinates under your cursor. You can turn this off in Settings for a harder game.
- **Animated reveal:** the map flies to fit your guess and the answer, a dotted path
  draws between them and a banner rises. Zones and capitals light up their whole outline,
  because anywhere inside them is a bullseye.
- **Daily puzzles:** the five places are seeded by date (Day #1 = 4 Nov 2026, WoW: Forever
  launch). Places come from shuffled "bags", so nothing repeats until a bag is used up.
- **Rising stakes:** rounds are worth 100 / 100 / 200 / 300 / 300. The multiplier shows on
  the clue card and in the round pips.
- **Hint:** reveals the continent, and that round scores 75% of what it would have.
- **Stats and streaks:** played, average, best, current and max streak, and a score
  histogram. Progress is saved, so you can reload mid-game.
- **Practice mode:** random places that don't count toward your stats.
- **Share:** uses the native share sheet on phones and copies to the clipboard on desktop.
  Open Graph and Twitter cards come with a custom 1200×630 image.
- **Polish:** procedural sound effects, confetti on great scores, a responsive mobile layout,
  keyboard play (<kbd>Enter</kbd> confirms or goes to the next round, <kbd>H</kbd> shows the
  hint), and support for `prefers-reduced-motion`.

### Libraries

| Library | Used for |
| --- | --- |
| [Leaflet](https://leafletjs.com) | Map engine (`CRS.Simple`), custom sparse terrain tile layer, overlays, markers |
| [GSAP](https://gsap.com) | Card, score count-up and reveal-line animations |
| [tsParticles](https://particles.js.org) | Ambient embers over the map |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | Celebrations |
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) | Tiny procedural sound effects (no audio files) |
| [seedrandom](https://github.com/davidbau/seedrandom) | Deterministic daily shuffles |
| [Fontsource](https://fontsource.org) | Self-hosted Cinzel + Cormorant Garamond |
| [Vite](https://vite.dev) · [Vitest](https://vitest.dev) · [sharp](https://sharp.pixelplumbing.com) | Build, tests, image processing |

## Getting started

```bash
npm install
npm run dev        # first run downloads the map imagery into public/map/ (~21 MB)
```

```bash
npm test           # daily-selection, geometry and scoring tests
npm run build      # type-check + production build into dist/
```

### Deploying

The build is fully static, so any static host works. A `netlify.toml` is included.
Social cards need absolute URLs, so set **`SITE_URL`** at build time
(e.g. `SITE_URL=https://pinpoint.example.com npm run build`). Netlify's `URL` and Vercel's
production URL are picked up automatically.

## Where the map comes from

The imagery and location data come from the **[wowforever.gg Azeroth Atlas](https://wowforever.gg/en/atlas/)**,
a fan-made interactive map of WoW: Forever.

- `npm run fetch-map` (`scripts/fetch-map.mjs`) downloads the terrain tile pyramid, the
  parchment overview screenshot and the ocean illustration. It bakes the atlas' water masks
  into the tiles as transparency, crops the in-game status bar off the overview and writes
  `public/map/manifest.json` with the calibrated bounds. **These files are git-ignored and are
  not redistributed in this repository.** They are fetched at dev/build time.
- `npm run build-data` (`scripts/build-data.mjs`) reduces the atlas' ~76 MB dataset to the
  committed `src/data/locations.json` (130 places) and `src/data/zones.json` (49 simplified zone
  outlines). Re-run it to pick up new places as the atlas grows. Places without a confirmed
  English name are skipped.
- `npm run make-og` re-renders `public/og-image.jpg` from `scripts/og/og.html` (needs Playwright).

World of Warcraft, its maps and all related art are © Blizzard Entertainment. This is an
unofficial fan project, not affiliated with Blizzard or wowforever.gg. **Before running it
publicly, please check with the wowforever.gg operator that they're happy for their
imagery to be used.** The overview keeps their watermark and the map credits them.

## How it works

| | |
| --- | --- |
| Coordinates | Leaflet `CRS.Simple` world units from the atlas (1 unit = 133⅓ yards). Zoom *z* = tile level *z* of the 512 px pyramid. |
| Scoring | Accuracy `100 · e^(−(yards − 75) / 2600)`, rounded. Under 75 yards from a point target is a bullseye. For zones and capitals, the distance is measured to the outline (inside = 0). Points = accuracy × the round multiplier `[1, 1, 2, 3, 3]`, so the maximum is 1,000. Emoji tiers use accuracy: 🎯 95+, 🟩 75+, 🟨 50+, 🟧 25+, 🟥 below. |
| Daily plan | `realm` (zone/capital) → `settlement` → `delve` (dungeon/raid) → `settlement` → `settlement`. Each tier is dealt from a seeded shuffle per cycle. Places that share an entrance (Molten Core and Blackrock Depths) never appear on the same day. |
| Storage | `localStorage` only (`azeroth-pinpoint:v1:*`). There is no backend. Saves from the original 5,000-point scale are converted on load. |

```
src/
  main.ts            game controller: rounds, reveal, results, dialogs, wiring
  map/mapView.ts     Leaflet setup, layer stack, pins, reveal & summary animations
  map/terrain.ts     sparse terrain GridLayer with parent-tile fallback
  game/daily.ts      puzzle numbering + deterministic daily selection
  game/scoring.ts    distance → score, emoji, titles
  game/geo.ts        point-in-zone, distance-to-outline, zone coords
  game/storage.ts    progress, stats, settings
  ui/                icons, sound (ZzFX), fx (particles/confetti), share
  data/              generated locations & zones
scripts/             fetch-map, build-data, make-og
```
