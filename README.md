# Wayfinder 🧭

A daily World of Warcraft geography game. Every day you get **five places in Azeroth**
(a zone or capital, a famous town, a lesser-known town or dungeon, and two famous
characters or quest targets – think Hogger, Thrall or Mankrik's wife) and drop a pin on the
**WoW: Forever** world map as close as you can. Each pin scores up to 100 for accuracy,
and the stakes rise: locations 1–2 count ×1, location 3 ×2 and locations 4–5 ×3, so a
perfect day is **1,000 points**. Same puzzle for everyone, a shareable emoji result, a
piece of lore from the archives, and leaderboards for all of Azeroth and for every
Discord server you share with other players.

```
Wayfinder · Nov 7, 2026 📍 857/1,000
🎯 100 · 🟩 94 · 🟩 150 · 🟨 213 · 🎯 300
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

## Built on two community projects

Wayfinder wouldn't exist without these two fan projects for WoW: Forever. Go and use them.

### wowforever.gg Azeroth Atlas

**Website:** [wowforever.gg/en/atlas](https://wowforever.gg/en/atlas/)

A fan-made interactive world map of WoW: Forever. Wayfinder draws its map from the Atlas:
the parchment overview, the full terrain tiles, the ocean art and the zone outlines. The
Atlas's place records (zones, capitals, towns, dungeon and raid entrances) are the starting
list of every puzzle location, alongside its copy of the QuestieDB Forever database and its
survey of flight paths, boats and zeppelins. Its imagery is downloaded at build time and is
not redistributed in this repository (see [Where the map comes from](#where-the-map-comes-from)).

### Polestar

**Website:** [polestar.guide](https://polestar.guide) · **Repository:** [github.com/fitzforge/polestar](https://github.com/fitzforge/polestar)

A free, open-source guide addon for WoW: Forever, with step-by-step leveling routes, a
waypoint arrow, and guides for class quests, professions, reputations and mounts. Its open
database, [forever-db](https://github.com/fitzforge/polestar/tree/main/forever-db), records
every NPC's spawn points in world yards along with each zone's map frames. Wayfinder uses it
to place famous characters and quest targets, to find town centres, and to cross-check
dungeon entrances. Its frame data is what fixed Eastern Plaguelands and Stormwind, where
WoW: Forever redrew the zone maps. Polestar's database tables are GPL-3.0 and its curated
layer is CC BY 4.0; its own sources are credited in
[forever-db/NOTICE.md](https://github.com/fitzforge/polestar/blob/main/forever-db/NOTICE.md).

## Architecture

Everything runs on Netlify.

| Piece | Where |
| --- | --- |
| Static game (Vite + TypeScript + Leaflet) | `index.html`, `src/` |
| Game API: deal / hint / guess, practice, leaderboards, stats, profile | `netlify/functions/api.mts` → `server/` |
| Discord OAuth sign-in and sign-out | `netlify/functions/auth.mts` → `server/discord.ts` |
| Nightly cleanup of expired sessions and idle guests (04:23 UTC) | `netlify/functions/cleanup.mts` |
| Postgres via **Netlify Database** | `netlify/database/migrations/` (applied automatically on deploy) |

- **Puzzles:** a new puzzle unlocks every day at midnight US Eastern time (EST/EDT; day 1 =
  4 Nov 2026, WoW: Forever launch). Rounds follow the multipliers: ×1 zone or capital, ×1
  popular town hub, ×2 lesser-known town / landmark / dungeon / raid, ×3 and ×3 famous
  character or quest target. The five places are drawn from shuffled "bags" seeded by the server-only
  `PUZZLE_SECRET`, then frozen in the `puzzles` table the first time a day is requested.
  Answers live in `server/data/places.json` and are never bundled into the client.
- **Sessions:** a random token in an `httpOnly`, `SameSite=Lax` cookie. Only its SHA-256 is
  stored. Guests get a session on their first move; Discord sign-in replaces it.
- **Discord:** only the `identify` and `guilds` scopes are requested. The access token is used
  once to read the profile and server list, then revoked, and it is never stored.
- **Hardening:** same-origin and JSON-only checks on every state-changing request, per-IP
  rate limits on both functions, input validation, row locks plus guarded updates so a
  round can only be scored once, and a `banned` flag on players.

### Deploying

The repository is linked to the Netlify project: **every push to `main` builds and deploys to
production** (`npm run build`, publishing `dist/`, per `netlify.toml`). Database migrations in
`netlify/database/migrations/` are applied to the production database just before each deploy
is published, and a failed migration blocks the publish. Other branches and pull requests get
preview deploys, each with its own copy of the database.

### Environment variables (Netlify → Project configuration → Environment variables)

| Name | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_CLIENT_SECRET` | Discord application client secret (mark as secret) |
| `PUZZLE_SECRET` | Random string that seeds daily puzzles. Changing it only affects days that haven't been generated yet. |
| `SITE_URL` | Public URL, used for absolute links in social cards (Netlify's `URL` is used if unset) |
| `DISCORD_WEBHOOK_URL` | Optional (mark as secret). Enables the daily Discord results post, see below. |

### Daily Discord results post

`netlify/functions/discord-daily.mts` posts the results of the puzzle that just ended
into a Discord channel, just after the midnight-Eastern reset. The post lists everyone from
that Discord server who played (ranked, with score, emoji row and time), who set out but didn't
finish, and the week's top three. Players appear as Discord mentions **without pinging anyone**.

1. In Discord: *Server Settings → Integrations → Webhooks → New Webhook*, pick the channel,
   then *Copy Webhook URL*. The server is worked out from the webhook itself.
2. In Netlify: add `DISCORD_WEBHOOK_URL` as a **secret** environment variable with the
   **Functions** scope, then redeploy.
3. Optional test: *Logs & metrics → Functions → discord-daily → Run now* posts the previous
   day's results. Each day is posted at most once (tracked in the `discord_posts` table).

Only players who have signed in to Wayfinder with Discord can appear: that's how the game
knows they're in your server.

### `/wayfinder` slash command

Anyone in a server where the Wayfinder app is installed can type **`/wayfinder`** to show that
server's board: `board: today` (live standings, the default), `yesterday` (final results) or
`week`, plus `private: true` to show it only to themselves. Discord calls
`netlify/functions/discord-interactions.mts` over HTTP, so no bot needs to be running;
requests are verified with the app's Ed25519 public key.

1. Discord Developer Portal → your app → *General Information* → copy **Public Key** → add it in
   Netlify as `DISCORD_PUBLIC_KEY`, then redeploy.
2. Same page → **Interactions Endpoint URL** →
   `https://azeroth-wayfinder.netlify.app/discord/interactions` → *Save* (Discord sends a signed
   test request, which only succeeds once step 1 is deployed).
3. *Installation* → make sure **Guild Install** is enabled with the `applications.commands`
   scope, then add the app to your server via
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=applications.commands`.

The command itself (`server/discord-commands.json`) is registered automatically after every
production build (`scripts/discord-register.mjs`, using the existing client ID and secret).
To register by hand: `DISCORD_CLIENT_ID=… DISCORD_CLIENT_SECRET=… npm run discord:register`.

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
- `npm run build-data` reduces the atlas dataset to `server/data/places.json` (207 places:
  zones, capitals, towns, dungeons and raids, plus famous characters and quest targets from
  `scripts/notable-npcs.json`; popular town hubs are listed in the script; server-only) and
  `src/data/zones.json` (49 simplified zone outlines). Every place is checked against several
  independent sources, and `docs/locations.md` records the candidates and the one used.
- Characters, quest targets and town centres are also drawn from **[Polestar's forever-db](https://github.com/fitzforge/polestar/tree/main/forever-db)**
  (`scripts/polestar.mjs`, pinned to a commit and cached in `.cache/`). Its spawn points are
  in world yards, so they don't depend on any zone-map frame. WoW: Forever re-framed four zone
  maps (`scripts/zone-frames.json`), so Classic-era coordinates are converted to the live frame,
  except in Eastern Plaguelands, whose map imagery is still drawn in the Era frame. The build
  checks our zone bounds against Polestar's live frames on every run.
- `src/data/lore.json` holds the original lore notes shown after each expedition.
- `npm run make-og` re-renders `public/og-image.jpg` from `scripts/og/og.html` (needs Playwright).

Location data from Polestar's forever-db is used under its licences: the database tables
under GPL-3.0 and the curated layer under CC BY 4.0 (© the Polestar contributors; sources
credited in [forever-db/NOTICE.md](https://github.com/fitzforge/polestar/blob/main/forever-db/NOTICE.md)).

World of Warcraft, its maps and all related art are © Blizzard Entertainment. This is an
unofficial fan project, not affiliated with Blizzard, wowforever.gg or Polestar. Please check with the
wowforever.gg operator that they're happy for their imagery to be used.
