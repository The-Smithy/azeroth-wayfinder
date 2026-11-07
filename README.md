# Wayfinder 🧭

A daily World of Warcraft geography game. Every day you get **five places in Azeroth**
(a capital or zone, three settlements and a dungeon entrance) and drop a pin on the
**WoW: Forever** world map as close as you can. Each pin scores up to 100 for accuracy,
and the stakes rise: locations 1–2 count ×1, location 3 ×2 and locations 4–5 ×3, so a
perfect day is **1,000 points**. Same puzzle for everyone, a shareable emoji result, a
piece of lore from the archives, and leaderboards for all of Azeroth and for every
Discord server you share with other players.

```
Wayfinder #4 📍 857/1,000
🎯🟩🟩🟨🎯
```

## Features

- **A map that feels like the game:** the in-game parchment world map cross-fades into the
  full terrain as you zoom in, over an animated ocean, with drifting clouds and embers. A
  zone hover HUD shows names, outlines and in-game coordinates (names are hidden on zone
  and capital rounds, where they would give the answer away).
- **Rising stakes:** rounds are worth 100 / 100 / 200 / 300 / 300.
- **Server-authoritative play:** the browser never receives coordinates. The server deals
  each clue, records hints and scores each guess, and only then reveals the answer. One
  ranked attempt per player per day; replays, skipped rounds and double submits are refused.
- **Leaderboards:** today and this week, globally and per Discord server. Ties go to the
  faster total time. Players can hide from the global board and still show on their
  servers' boards.
- **Discord sign-in:** guests can play straight away; signing in carries today's game over.
- **From the Archives:** after the fifth pin, a short lore note about one of the day's places.
- **Practice mode**, stats and streaks, a hint (reveals the continent for 75% of the round),
  native share or clipboard, Open Graph/Twitter cards, procedural sound, confetti, keyboard
  play, a responsive mobile layout and `prefers-reduced-motion` support.

## Architecture

Everything runs on Netlify.

| Piece | Where |
| --- | --- |
| Static game (Vite + TypeScript + Leaflet) | `index.html`, `src/` |
| Game API: deal / hint / guess, practice, leaderboards, stats, profile | `netlify/functions/api.mts` → `server/` |
| Discord OAuth sign-in and sign-out | `netlify/functions/auth.mts` → `server/discord.ts` |
| Nightly cleanup of expired sessions and idle guests (04:23 UTC) | `netlify/functions/cleanup.mts` |
| Postgres via **Netlify Database** | `netlify/database/migrations/` (applied automatically on deploy) |

- **Puzzles:** a new puzzle unlocks every day at 00:00 UTC (#1 = 4 Nov 2026, WoW: Forever
  launch). The five places are drawn from shuffled "bags" seeded by the server-only
  `PUZZLE_SECRET`, then frozen in the `puzzles` table the first time a day is requested.
  Answers live in `server/data/places.json` and are never bundled into the client.
- **Sessions:** a random token in an `httpOnly`, `SameSite=Lax` cookie. Only its SHA-256 is
  stored. Guests get a session on their first move; Discord sign-in replaces it.
- **Discord:** only the `identify` and `guilds` scopes are requested. The access token is used
  once to read the profile and server list, then revoked, and it is never stored.
- **Hardening:** same-origin and JSON-only checks on every state-changing request, per-IP
  rate limits on both functions, input validation, row locks plus guarded updates so a
  round can only be scored once, and a `banned` flag on players.

### Environment variables (Netlify → Project configuration → Environment variables)

| Name | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_CLIENT_SECRET` | Discord application client secret (mark as secret) |
| `PUZZLE_SECRET` | Random string that seeds daily puzzles. Changing it only affects days that haven't been generated yet. |
| `SITE_URL` | Public URL, used for absolute links in social cards (Netlify's `URL` is used if unset) |

The Discord app needs the redirect `https://<your-site>/auth/discord/callback`.

To moderate a player, set `players.banned = true` for them (for example from the Netlify
Database UI). They disappear from every board and can't play ranked games.

## Getting started

```bash
npm install
npm run dev        # Vite + Netlify Functions + a local Netlify Database
npm run db:migrate # once per fresh local database, while dev is running
```

The first `npm run dev` also downloads the map imagery into `public/map/` (~21 MB).
Locally, `PUZZLE_SECRET` comes from `[context.dev.environment]` in `netlify.toml`.
To try Discord sign-in locally, export `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` in your
shell and add `http://localhost:5173/auth/discord/callback` to your Discord app's redirects.

```bash
npm test           # unit tests + integration tests against a local Postgres
npm run build      # type-check + production build
```

## Libraries

| Library | Used for |
| --- | --- |
| [Leaflet](https://leafletjs.com) | Map engine (`CRS.Simple`), custom sparse terrain tile layer, overlays, markers |
| [GSAP](https://gsap.com) | Card, score count-up and reveal animations |
| [tsParticles](https://particles.js.org) | Ambient embers over the map |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | Celebrations |
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) | Procedural sound effects (no audio files) |
| [seedrandom](https://github.com/davidbau/seedrandom) | Deterministic daily shuffles |
| [@netlify/database](https://docs.netlify.com/build/data-and-storage/netlify-database/) · [@netlify/functions](https://docs.netlify.com/build/functions/overview/) | Backend |
| [Fontsource](https://fontsource.org) · [Vite](https://vite.dev) · [Vitest](https://vitest.dev) · [sharp](https://sharp.pixelplumbing.com) | Fonts, build, tests, image processing |

## Where the map comes from

The imagery and location data come from the **[wowforever.gg Azeroth Atlas](https://wowforever.gg/en/atlas/)**,
a fan-made interactive map of WoW: Forever.

- `npm run fetch-map` downloads the terrain tile pyramid, the parchment overview and the ocean
  illustration, bakes the atlas' water masks into the tiles, and writes calibrated bounds to
  `public/map/manifest.json`. **These files are git-ignored and not redistributed here.** They
  are fetched at dev and build time.
- `npm run build-data` reduces the atlas dataset to `server/data/places.json` (130 places,
  server-only) and `src/data/zones.json` (49 simplified zone outlines).
- `src/data/lore.json` holds the original lore notes shown after each expedition.
- `npm run make-og` re-renders `public/og-image.jpg` from `scripts/og/og.html` (needs Playwright).

World of Warcraft, its maps and all related art are © Blizzard Entertainment. This is an
unofficial fan project, not affiliated with Blizzard or wowforever.gg. Please check with the
wowforever.gg operator that they're happy for their imagery to be used.
