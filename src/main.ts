import 'leaflet/dist/leaflet.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './styles/main.css';

import { gsap } from 'gsap';
import zonesJson from './data/zones.json';
import type { LatLngTuple, MapManifest, Zone } from './types';
import type { Clue, Leaderboard, LeaderboardEntry, Me, Period, PlayedRound, RankInfo, RoundOutcome } from './api-types';
import { api, ApiError } from './api';
import { emojiFor, formatYards, MAX_ROUND_SCORE, multiplierFor, ROUNDS, tierFor, titleFor } from './game/scoring';
import { loadSettings, saveSettings, type Settings } from './game/storage';
import { MapView, type MapStyle } from './map/mapView';
import { crest, factionLabels, icons, kindIcons, kindLabels, shield } from './ui/icons';
import { play, setSoundEnabled, soundForScore, unlockAudio } from './ui/sound';
import { celebrate, startEmbers } from './ui/fx';
import { shareResult, shareText } from './ui/share';

const zones = zonesJson as unknown as Record<string, Zone>;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ state ----
type Phase = 'loading' | 'placing' | 'revealed' | 'finished';
interface Game {
  mode: 'daily' | 'practice';
  day: number;
  resetsAt: number;
  /** Clues dealt so far (practice: all five up front). */
  clues: Clue[];
  played: PlayedRound[];
  current: number;
  phase: Phase;
  guess: LatLngTuple | null;
  hint: boolean;
  busy: boolean;
  rank: RankInfo | null;
}

const settings: Settings = loadSettings();
let game: Game = { mode: 'daily', day: 0, resetsAt: 0, clues: [], played: [], current: 0, phase: 'loading', guess: null, hint: false, busy: false, rank: null };
let me: Me = { player: null, servers: [], discordEnabled: false, day: 0 };
let view: MapView;

// ------------------------------------------------------------------- icons ----
function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    const name = el.dataset.icon!;
    el.innerHTML = name === 'crest' ? crest : (icons as Record<string, string>)[name] ?? '';
  });
}

// --------------------------------------------------------------- boot -------
async function boot() {
  hydrateIcons();
  setSoundEnabled(settings.sound);
  syncSoundButton();

  let manifest: MapManifest;
  try {
    const res = await fetch('/map/manifest.json');
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json();
  } catch {
    loaderError('The map could not be found.<br><small>Run <code>npm run fetch-map</code> to download the imagery.</small>');
    return;
  }

  view = new MapView($('map'), manifest, zones);
  view.setStyle(settings.mapStyle);
  view.setZoneOutline(settings.zoneLabels);
  view.onPick = pick;
  view.onHover = ({ zone, coords }) => {
    // On zone & capital rounds the label would give the answer away.
    const clue = game.clues[game.current];
    const spoiler = game.phase === 'placing' && !!clue?.area;
    const show = !!zone && settings.zoneLabels && !spoiler;
    $('readout').classList.toggle('is-visible', show);
    $('readout-zone').textContent = show ? zone : '';
    $('readout-coords').textContent = show && coords ? `${coords[0].toFixed(1)}, ${coords[1].toFixed(1)}` : '';
  };
  wireControls();
  if (import.meta.env.DEV) Object.assign(window, { __wayfinder: { view, get game() { return game; } } });

  try {
    await Promise.all([view.ready().catch(() => {}), refreshMe(), startDaily()]);
  } catch (err) {
    loaderError(`${escapeHtml(err instanceof ApiError ? err.message : 'The expedition could not be started.')}<br><button class="btn btn--primary" onclick="location.reload()">Try again</button>`);
    return;
  }

  const loader = $('loader');
  gsap.to(loader, { opacity: 0, duration: reduced() ? 0 : 0.8, delay: 0.2, onComplete: () => loader.remove() });
  void startEmbers('embers');
  handleAuthReturn();
  if (!settings.seenHelp) {
    settings.seenHelp = true;
    saveSettings(settings);
    setTimeout(() => openDialog('dlg-help'), 700);
  }
}

function loaderError(html: string) {
  $('loader-text').innerHTML = html;
  $('loader').classList.add('is-error');
}

const AUTH_MESSAGES: Record<string, string> = {
  cancelled: 'Discord sign-in cancelled.',
  bad_state: 'Sign-in expired – please try again.',
  banned: 'This account has been barred from the expedition.',
  discord_not_configured: 'Discord sign-in is not available yet.',
  discord_error: 'Discord could not be reached – please try again.',
};
function handleAuthReturn() {
  const params = new URLSearchParams(location.search);
  const code = params.get('auth');
  if (!code) return;
  toast(AUTH_MESSAGES[code] ?? 'Sign-in failed – please try again.', 4000);
  params.delete('auth');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
}

// ------------------------------------------------------------- account ------
async function refreshMe() {
  me = await api.me();
  const btn = $('btn-account');
  const p = me.player;
  btn.classList.toggle('is-signed-in', !!p?.discord);
  $('account-avatar').innerHTML = p?.discord && p.avatar ? avatarImg(p.avatar, 28) : icons.discord;
  $('account-name').textContent = p?.discord ? p.name : 'Sign in';
  btn.setAttribute('aria-label', p?.discord ? `Account: ${p.name}` : 'Sign in with Discord');
}

const avatarImg = (src: string, size: number) =>
  `<img src="${escapeHtml(src)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer" />`;

const signInHref = () => `/auth/discord?return=${encodeURIComponent(location.pathname + location.search)}`;

function signInButton(label = 'Sign in with Discord') {
  return me.discordEnabled
    ? `<a class="btn btn--discord" href="${signInHref()}">${icons.discord}<span>${label}</span></a>`
    : `<button class="btn btn--discord" type="button" disabled>${icons.discord}<span>Discord sign-in coming soon</span></button>`;
}

function openAccount() {
  play('click');
  const p = me.player;
  const card = $('account-card');
  if (!p?.discord) {
    card.innerHTML = `
      <p class="modal__kicker">Join the ranks</p>
      <h2 class="modal__title" id="account-title">Claim your place</h2>
      <p class="modal__lede">Sign in with Discord to appear on the leaderboards – globally and on a board for every Discord server you share with other players.</p>
      <ul class="perks">
        <li>🏆 Daily &amp; weekly rankings</li>
        <li>🛡️ Boards for your guild's Discord</li>
        <li>🔥 Streaks that follow you across devices</li>
      </ul>
      ${signInButton()}
      <p class="modal__fine">We only read your Discord name, avatar and server list. Today's progress carries over when you sign in.</p>`;
  } else {
    card.innerHTML = `
      <div class="account-card__head">
        ${p.avatar ? avatarImg(p.avatar, 64) : ''}
        <div><p class="modal__kicker">Signed in with Discord</p><h2 class="modal__title" id="account-title">${escapeHtml(p.name)}</h2></div>
      </div>
      <label class="toggle"><input type="checkbox" id="set-public" ${p.isPublic ? 'checked' : ''} /><span class="toggle__ui"></span> Show me on the global leaderboard</label>
      <p class="modal__fine">Discord server boards always show you to fellow members.</p>
      <h3 class="subhead">Your server boards</h3>
      ${me.servers.length
        ? `<ul class="servers">${me.servers.map(s => `<li>${s.icon ? avatarImg(s.icon, 28) : '<span class="servers__blank"></span>'}<span>${escapeHtml(s.name)}</span><small>${s.players} players</small></li>`).join('')}</ul>`
        : '<p class="modal__fine">No one else from your Discord servers has played yet – share today\'s result in your guild chat!</p>'}
      <button class="btn btn--ghost btn--wide" type="button" id="btn-signout">Sign out</button>`;
    $('set-public').addEventListener('change', async e => {
      const input = e.target as HTMLInputElement;
      try {
        await api.setPublic(input.checked);
        if (me.player) me.player.isPublic = input.checked;
        toast(input.checked ? 'You\'ll appear on the global board.' : 'Hidden from the global board.');
      } catch (err) { input.checked = !input.checked; reportError(err); }
    });
    $('btn-signout').addEventListener('click', async () => {
      try { await api.logout(); } finally { location.reload(); }
    });
  }
  openDialog('dlg-account');
}

// --------------------------------------------------------------- flow -------
async function startDaily() {
  const state = await api.daily();
  game = {
    mode: 'daily',
    day: state.day,
    resetsAt: Date.parse(state.resetsAt),
    clues: [...state.rounds.map(r => r.clue), ...(state.current ? [state.current] : [])],
    played: state.rounds,
    current: state.rounds.length,
    phase: 'loading',
    guess: null,
    hint: false,
    busy: false,
    rank: state.rank,
  };
  document.body.classList.remove('is-practice');
  renderPips();
  updateTotal(false);
  if (state.finished) { finish(false); return; }
  if (!state.current) game.clues.push(await api.dealRound(state.day));
  showRound();
}

async function startPractice() {
  try {
    const { clues } = await api.practice();
    game = { mode: 'practice', day: 0, resetsAt: game.resetsAt, clues, played: [], current: 0, phase: 'loading', guess: null, hint: false, busy: false, rank: null };
  } catch (err) { reportError(err); return; }
  document.body.classList.add('is-practice');
  renderPips();
  updateTotal(false);
  view.home();
  showRound();
}

function showRound() {
  const clue = game.clues[game.current];
  game.phase = 'placing';
  game.guess = null;
  game.hint = !!clue.hint;
  view.clearRound();

  $('clue-kind').innerHTML = `${kindIcons[clue.kind]}<span>${kindLabels[clue.kind]}</span>`;
  const faction = $('clue-faction');
  faction.hidden = clue.kind === 'zone' || clue.kind === 'dungeon' || clue.kind === 'raid';
  faction.innerHTML = `${shield(clue.faction)}<span>${factionLabels[clue.faction]}</span>`;
  // Practice games say so on the card, since they don't count towards the boards.
  $('clue-round').textContent = `${game.mode === 'practice' ? 'Practice · ' : ''}Location ${game.current + 1} of ${ROUNDS}`;
  const multBadge = $('clue-mult');
  multBadge.hidden = clue.multiplier === 1;
  multBadge.textContent = `×${clue.multiplier} points`;
  setName(clue.name);
  if (clue.hint) showHintText(clue.hint);
  else {
    $('clue-prompt').textContent = clue.area
      ? 'Drop your pin anywhere inside it.'
      : clue.kind === 'dungeon' || clue.kind === 'raid'
        ? 'Drop your pin on the entrance.'
        : 'Drop your pin where you think it lies.';
  }
  $('result').hidden = true;
  $('btn-next').hidden = true;
  const hintBtn = $<HTMLButtonElement>('btn-hint');
  hintBtn.hidden = false;
  hintBtn.disabled = !!clue.hint;
  const confirm = $<HTMLButtonElement>('btn-confirm');
  confirm.hidden = false;
  confirm.disabled = true;
  confirm.textContent = 'Drop a pin on the map';
  $('card').classList.remove('is-revealed', 'is-finished');
  renderPips();

  if (!reduced()) gsap.fromTo('#card .card__frame', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'power3.out' });
}

function showHintText(continent: string) {
  $('clue-prompt').innerHTML = `<span class="hint-text">${kindIcons.zone} Somewhere in <strong>${escapeHtml(continent)}</strong>.</span>`;
}

function setName(name: string) {
  const el = $('clue-name');
  el.innerHTML = [...name].map(ch => `<span class="ch">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`).join('');
  if (!reduced()) gsap.from(el.querySelectorAll('.ch'), { opacity: 0, y: 8, filter: 'blur(4px)', duration: 0.4, stagger: 0.022, ease: 'power2.out' });
}

function pick(latlng: LatLngTuple) {
  if (game.phase !== 'placing' || game.busy) return;
  void unlockAudio();
  const first = !game.guess;
  game.guess = latlng;
  view.placeGuess(latlng);
  play('drop');
  const confirm = $<HTMLButtonElement>('btn-confirm');
  confirm.disabled = false;
  confirm.textContent = 'Confirm pin';
  if (first && !reduced()) gsap.fromTo(confirm, { scale: 0.94 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
}

async function useHint() {
  if (game.phase !== 'placing' || game.hint || game.busy) return;
  const clue = game.clues[game.current];
  const btn = $<HTMLButtonElement>('btn-hint');
  btn.disabled = true;
  game.busy = true;
  try {
    const { continent } = game.mode === 'daily' ? await api.hint(game.day, clue.round) : await api.practiceHint(clue.ref!);
    game.hint = true;
    clue.hint = continent;
    play('hint');
    showHintText(continent);
    view.focusContinent(continent);
  } catch (err) {
    btn.disabled = false;
    reportError(err);
  } finally {
    game.busy = false;
  }
}

async function confirmGuess() {
  if (game.phase !== 'placing' || !game.guess || game.busy) return;
  const clue = game.clues[game.current];
  const [lat, lng] = game.guess;
  const confirm = $<HTMLButtonElement>('btn-confirm');
  confirm.disabled = true;
  confirm.textContent = 'Consulting the archives…';
  game.busy = true;
  let outcome: RoundOutcome;
  try {
    if (game.mode === 'daily') {
      const res = await api.guess(game.day, clue.round, lat, lng);
      outcome = res.outcome;
      game.rank = res.rank;
    } else {
      outcome = await api.practiceGuess(clue.ref!, clue.round, lat, lng, game.hint);
    }
  } catch (err) {
    game.busy = false;
    confirm.disabled = false;
    confirm.textContent = 'Confirm pin';
    reportError(err);
    return;
  }
  game.busy = false;
  game.phase = 'revealed';
  game.played.push({ clue, outcome });

  $('btn-confirm').hidden = true;
  $('btn-hint').hidden = true;
  play('whoosh');
  const { answer, yards, score, points } = outcome;
  await view.reveal(outcome.guess, answer.anchor, { name: clue.name, latlng: answer.latlng, area: answer.area }, yards ? formatYards(yards) : '');

  play(soundForScore(score));
  if (score >= 95) celebrate();
  $('card').classList.add('is-revealed');
  $('result').hidden = false;
  $('clue-prompt').textContent = '';
  $('result-distance').textContent = yards === 0 ? (clue.area ? 'Right inside – bullseye!' : 'Bullseye!') : `${formatYards(yards)} away`;
  $('result-where').innerHTML = `${escapeHtml(answer.zone === clue.name ? answer.continent : `${answer.zone}, ${answer.continent}`)}${outcome.hint ? ' · <em>hint used</em>' : ''}`;
  $('result-max').textContent = `/ ${MAX_ROUND_SCORE * clue.multiplier}`;
  $('result-mult').textContent = clue.multiplier > 1 ? `${score} accuracy × ${clue.multiplier}` : `${score} accuracy`;
  countUp($('result-score'), 0, points, 0.9);
  if (!reduced()) gsap.fromTo('#result', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 });
  renderPips();
  updateTotal(true);

  game.current++;
  const next = $('btn-next');
  next.hidden = false;
  next.textContent = game.current >= ROUNDS ? 'See your results ▸' : 'Next location ▸';
  next.focus({ preventScroll: true });
}

async function nextRound() {
  if (game.phase !== 'revealed' || game.busy) return;
  play('click');
  if (game.current >= ROUNDS) { finish(true); return; }
  if (game.mode === 'daily' && !game.clues[game.current]) {
    const next = $<HTMLButtonElement>('btn-next');
    next.disabled = true;
    game.busy = true;
    try {
      game.clues.push(await api.dealRound(game.day));
    } catch (err) {
      reportError(err);
      return;
    } finally {
      game.busy = false;
      next.disabled = false;
    }
  }
  view.home();
  showRound();
}

const totalPoints = () => game.played.reduce((s, r) => s + r.outcome.points, 0);

function finish(fresh: boolean) {
  game.phase = 'finished';
  const total = totalPoints();
  showSummaryOnMap();
  $('card').classList.add('is-finished');
  $('clue-kind').innerHTML = `${kindIcons.landmark}<span>${game.mode === 'daily' ? 'Today\'s expedition' : 'Practice'}</span>`;
  $('clue-faction').hidden = true;
  $('clue-mult').hidden = true;
  $('clue-round').textContent = 'Complete';
  setName(`${total.toLocaleString('en-US')} points`);
  $('clue-prompt').textContent = game.played.map(r => emojiFor(r.outcome.score)).join(' ');
  $('result').hidden = true;
  $('btn-hint').hidden = true;
  $('btn-confirm').hidden = true;
  const next = $('btn-next');
  next.hidden = false;
  next.textContent = 'Show results';
  renderPips();
  updateTotal(false);
  void openResults(fresh);
  if (fresh) {
    play('fanfare');
    if (total >= 800) celebrate(true);
  }
}

function showSummaryOnMap() {
  view.showSummary(game.played.map(({ clue, outcome }) => ({
    guess: outcome.guess,
    anchor: outcome.answer.anchor,
    place: { name: clue.name, latlng: outcome.answer.latlng, area: outcome.answer.area },
  })));
}

// ------------------------------------------------------------- render -------
function renderPips() {
  $('pips').innerHTML = Array.from({ length: ROUNDS }, (_, i) => {
    const r = game.played[i]?.outcome;
    const mult = multiplierFor(i);
    const current = i === game.current && game.phase !== 'finished';
    const cls = r ? `pip is-done pip--${tierFor(r.score)}` : current ? 'pip is-current' : 'pip';
    const label = r ? `${game.played[i].clue.name}: ${r.points} of ${MAX_ROUND_SCORE * mult} points` : `${current ? 'Current' : 'Upcoming'} location – worth up to ${MAX_ROUND_SCORE * mult}`;
    const text = r ? String(r.points) : mult > 1 ? `×${mult}` : String(i + 1);
    return `<li class="${cls}${!r && mult > 1 ? ' pip--mult' : ''}" title="${escapeHtml(label)}"><span class="pip__gem"></span><span class="pip__score">${text}</span></li>`;
  }).join('');
}

let shownTotal = 0;
function updateTotal(animate: boolean) {
  const total = totalPoints();
  const el = $('total');
  if (animate) countUp(el, shownTotal, total, 1);
  else el.textContent = total.toLocaleString('en-US');
  shownTotal = total;
}

function countUp(el: HTMLElement, from: number, to: number, duration: number) {
  if (reduced()) { el.textContent = to.toLocaleString('en-US'); return; }
  const o = { v: from };
  gsap.to(o, { v: to, duration, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString('en-US'); } });
}

function renderRankLine() {
  const el = $('results-rank');
  el.hidden = game.mode !== 'daily';
  if (el.hidden) return;
  if (game.rank) {
    el.innerHTML = `<strong>#${game.rank.rank}</strong> of ${game.rank.of.toLocaleString('en-US')} on today's global board`;
  } else if (me.player?.discord && !me.player.isPublic) {
    el.innerHTML = 'You\'re hidden from the global board – see your server boards.';
  } else if (!me.player?.discord) {
    el.innerHTML = `<span>Put this score on the leaderboard:</span> ${signInButton()}`;
  } else {
    el.hidden = true;
  }
}

async function openResults(fresh: boolean) {
  const total = totalPoints();
  const [, title, flavor] = titleFor(total);
  $('results-kicker').textContent = game.mode === 'daily' ? `${puzzleDate('long')} · complete` : 'Practice complete';
  $('results-title').textContent = title;
  $('results-flavor').textContent = flavor;
  $('results-rounds').innerHTML = game.played.map(({ clue, outcome: r }) => {
    const max = MAX_ROUND_SCORE * clue.multiplier;
    return `<li class="round round--${tierFor(r.score)}">
      <span class="round__emoji">${emojiFor(r.score)}</span>
      <span class="round__name">${escapeHtml(clue.name)}<small>${kindLabels[clue.kind]} · ${escapeHtml(r.answer.zone === clue.name ? r.answer.continent : r.answer.zone)}</small></span>
      <span class="round__dist">${r.yards === 0 ? 'Bullseye' : formatYards(r.yards)}${r.hint ? ' · hint' : ''}</span>
      <span class="round__score">${r.points}<small>/${max}</small></span>
    </li>`;
  }).join('');
  renderRankLine();
  void renderLore();
  $('results-actions').hidden = false;
  $('next-wrap').hidden = game.mode !== 'daily';
  $('btn-practice').textContent = game.mode === 'daily' ? 'Practice with random places' : 'Another practice run';
  openDialog('dlg-results');
  const totalEl = $('results-total');
  if (fresh) countUp(totalEl, 0, total, 1.6);
  else totalEl.textContent = total.toLocaleString('en-US');
  if (!reduced()) gsap.from('#results-rounds .round', { x: -16, opacity: 0, stagger: 0.08, duration: 0.4, delay: 0.15 });
  await renderStats();
}

/**
 * A short piece of lore about one of the expedition's places. Daily games pick the
 * same place for everyone (something to talk about in guild chat); practice picks at random.
 */
async function renderLore() {
  const box = $('results-lore');
  box.hidden = true;
  let lore: Record<string, string>;
  try { lore = (await import('./data/lore.json')).default as Record<string, string>; } catch { return; }
  const candidates = game.played.map(r => r.clue.name).filter(name => lore[name]);
  if (!candidates.length || game.phase !== 'finished') return;
  const name = game.mode === 'daily'
    ? candidates[(game.day * 7) % candidates.length]
    : candidates[Math.floor(Math.random() * candidates.length)];
  $('lore-name').textContent = name;
  $('lore-text').textContent = lore[name];
  box.hidden = false;
  if (!reduced()) gsap.fromTo(box, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.5 });
}

async function renderStats() {
  const box = $('stats');
  try {
    const s = await api.stats();
    const max = Math.max(1, ...s.buckets);
    box.innerHTML = `
      <div class="stats__grid">
        <div><strong>${s.played}</strong><span>Played</span></div>
        <div><strong>${s.average.toLocaleString('en-US')}</strong><span>Average</span></div>
        <div><strong>${s.best.toLocaleString('en-US')}</strong><span>Best</span></div>
        <div><strong>${s.streak}</strong><span>Streak</span></div>
        <div><strong>${s.maxStreak}</strong><span>Max streak</span></div>
      </div>
      <div class="stats__bars" aria-label="Score distribution">
        ${s.buckets.map((n, i) => `<div class="bar"><span class="bar__label">${i * 200}+</span><span class="bar__track"><span class="bar__fill" style="--w:${(n / max) * 100}%">${n}</span></span></div>`).join('')}
      </div>`;
  } catch {
    box.innerHTML = '<p class="modal__fine">Stats are unavailable right now.</p>';
  }
}

function openStats() {
  play('click');
  if (game.phase === 'finished' && game.mode === 'daily') { void openResults(false); return; }
  $('results-rounds').innerHTML = '';
  $('results-kicker').textContent = 'Your record';
  $('results-title').textContent = 'Statistics';
  $('results-flavor').textContent = 'Finish today\'s expedition to see your score here.';
  $('results-total').textContent = totalPoints().toLocaleString('en-US');
  $('results-rank').hidden = true;
  $('results-lore').hidden = true;
  $('results-actions').hidden = true;
  $('next-wrap').hidden = false;
  openDialog('dlg-results');
  void renderStats();
}

// ---------------------------------------------------------- leaderboard -----
let boardPeriod: Period = 'day';
let boardScope = 'global';
let boardRequest = 0;

function openLeaderboard() {
  play('click');
  const select = $<HTMLSelectElement>('board-scope');
  select.innerHTML = `<option value="global">🌍 All of Azeroth</option>${me.servers
    .map(s => `<option value="${escapeHtml(s.id)}">🛡️ ${escapeHtml(s.name)} (${s.players})</option>`).join('')}`;
  if (![...select.options].some(o => o.value === boardScope)) boardScope = 'global';
  select.value = boardScope;
  select.disabled = !me.servers.length;
  const cta = $('board-cta');
  cta.hidden = !!me.player?.discord;
  if (!cta.hidden) cta.innerHTML = `<p>Sign in to rank globally and on your Discord servers' boards.</p>${signInButton()}`;
  $('board-kicker').textContent = puzzleDate('long');
  openDialog('dlg-leaderboard');
  void loadBoard();
}

async function loadBoard() {
  const request = ++boardRequest;
  const list = $('board-list');
  list.innerHTML = '<li class="board__empty">Unrolling the scrolls…</li>';
  $('board-me').hidden = true;
  let board: Leaderboard;
  try {
    board = await api.leaderboard(boardPeriod, boardScope);
  } catch (err) {
    if (request !== boardRequest) return;
    list.innerHTML = `<li class="board__empty">${escapeHtml(err instanceof ApiError ? err.message : 'The leaderboard is unavailable.')}</li>`;
    return;
  }
  if (request !== boardRequest) return;
  list.innerHTML = board.entries.length
    ? board.entries.map(e => boardRow(e, board.period)).join('')
    : `<li class="board__empty">${board.period === 'day' ? 'No one has finished today\'s expedition yet. Be the first!' : 'No finished expeditions this week yet.'}</li>`;
  const mine = board.me;
  const meBox = $('board-me');
  meBox.hidden = !mine || board.entries.some(e => e.me);
  if (mine && !meBox.hidden) meBox.innerHTML = `<ol class="board">${boardRow(mine, board.period)}</ol>`;
  $('board-foot').textContent = `${board.players.toLocaleString('en-US')} ranked ${board.players === 1 ? 'player' : 'players'} · ties go to the faster time${board.period === 'week' ? ' · last 7 expeditions' : ''}`;
  if (!reduced()) gsap.from('#board-list .entry', { y: 8, opacity: 0, stagger: 0.025, duration: 0.3 });
}

function boardRow(e: LeaderboardEntry, period: Period) {
  const medal = e.rank <= 3 ? ` entry--top${e.rank}` : '';
  const detail = period === 'day' ? (e.scores ?? []).map(emojiFor).join('') : `${e.games} ${e.games === 1 ? 'expedition' : 'expeditions'}`;
  return `<li class="entry${medal}${e.me ? ' entry--me' : ''}">
    <span class="entry__rank">${e.rank}</span>
    <span class="entry__avatar">${e.avatar ? avatarImg(e.avatar, 32) : ''}</span>
    <span class="entry__name"><span class="entry__who">${escapeHtml(e.name)}${e.me ? ' <em>(you)</em>' : ''}</span><small>${detail}</small></span>
    <span class="entry__time">${fmtTime(e.ms)}</span>
    <span class="entry__points">${e.points.toLocaleString('en-US')}</span>
  </li>`;
}

/** Today's puzzle date in US Eastern time (puzzles roll over at midnight Eastern). */
function puzzleDate(style: 'long' | 'short') {
  const at = new Date((game.resetsAt || Date.now() + 1) - 1);
  return at.toLocaleDateString('en-US', style === 'long'
    ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' }
    : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------- dialogs ------
function openDialog(id: string) {
  const dlg = $<HTMLDialogElement>(id);
  if (dlg.open) return;
  dlg.showModal();
  if (!reduced()) gsap.fromTo(dlg.querySelector('.modal__frame'), { y: 24, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' });
}

let countdownTimer = 0;
function tickCountdown() {
  if (!game.resetsAt) return;
  const ms = Math.max(0, game.resetsAt - Date.now());
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
  $('countdown').textContent = [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  // A new day: reload so everyone moves to the new puzzle (unless mid-practice).
  if (ms === 0 && game.mode === 'daily' && !game.busy) location.reload();
}

function toast(msg: string, duration = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el.classList.remove('is-visible'), duration);
}

/** Show an API failure; recover from state drift by resyncing with the server. */
function reportError(err: unknown) {
  if (!(err instanceof ApiError)) { console.error(err); toast('Something went wrong – please try again.', 3500); return; }
  toast(err.message, 3500);
  if (err.code === 'stale_day') setTimeout(() => location.reload(), 1800);
  else if (game.mode === 'daily' && ['no_open_round', 'finished', 'no_session'].includes(err.code)) void startDaily().catch(() => {});
}

function syncSoundButton() {
  const btn = $('btn-sound');
  btn.innerHTML = settings.sound ? icons.sound : icons.mute;
  btn.setAttribute('aria-pressed', String(settings.sound));
}

const styleLabels: Record<MapStyle, string> = { auto: 'Map: auto (parchment → terrain)', parchment: 'Map: parchment', terrain: 'Map: terrain' };
function setMapStyle(style: MapStyle) {
  settings.mapStyle = style;
  saveSettings(settings);
  view.setStyle(style);
  document.querySelectorAll<HTMLInputElement>('input[name="map-style"]').forEach(r => (r.checked = r.value === style));
}

// --------------------------------------------------------------- wiring -----
function wireControls() {
  $('btn-confirm').addEventListener('click', () => void confirmGuess());
  $('btn-next').addEventListener('click', () => (game.phase === 'finished' ? void openResults(false) : void nextRound()));
  $('btn-hint').addEventListener('click', () => void useHint());
  $('btn-help').addEventListener('click', () => { play('click'); openDialog('dlg-help'); });
  $('btn-stats').addEventListener('click', openStats);
  $('btn-leaderboard').addEventListener('click', openLeaderboard);
  $('btn-results-board').addEventListener('click', () => { $<HTMLDialogElement>('dlg-results').close(); openLeaderboard(); });
  $('btn-account').addEventListener('click', openAccount);
  $('board-scope').addEventListener('change', e => { boardScope = (e.target as HTMLSelectElement).value; void loadBoard(); });
  document.querySelectorAll<HTMLInputElement>('input[name="board-period"]').forEach(r =>
    r.addEventListener('change', () => { boardPeriod = r.value as Period; void loadBoard(); }),
  );
  $('btn-settings').addEventListener('click', () => {
    play('click');
    $<HTMLInputElement>('set-sound').checked = settings.sound;
    $<HTMLInputElement>('set-zones').checked = settings.zoneLabels;
    setMapStyle(settings.mapStyle);
    openDialog('dlg-settings');
  });
  $('btn-sound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    setSoundEnabled(settings.sound);
    saveSettings(settings);
    syncSoundButton();
    play('click');
  });
  $('set-sound').addEventListener('change', e => { settings.sound = (e.target as HTMLInputElement).checked; setSoundEnabled(settings.sound); saveSettings(settings); syncSoundButton(); });
  $('set-zones').addEventListener('change', e => { settings.zoneLabels = (e.target as HTMLInputElement).checked; view.setZoneOutline(settings.zoneLabels); saveSettings(settings); });
  document.querySelectorAll<HTMLInputElement>('input[name="map-style"]').forEach(r => r.addEventListener('change', () => setMapStyle(r.value as MapStyle)));

  $('zoom-in').addEventListener('click', () => view.zoomBy(0.75));
  $('zoom-out').addEventListener('click', () => view.zoomBy(-0.75));
  $('zoom-home').addEventListener('click', () => view.home());
  $('map-style').addEventListener('click', () => {
    const order: MapStyle[] = ['auto', 'parchment', 'terrain'];
    const next = order[(order.indexOf(settings.mapStyle) + 1) % order.length];
    setMapStyle(next);
    toast(styleLabels[next]);
  });

  $('btn-share').addEventListener('click', async () => {
    const text = shareText({ date: game.mode === 'daily' ? puzzleDate('short') : null, total: totalPoints(), rounds: game.played.map(r => r.outcome), site: location.host });
    const outcome = await shareResult(text);
    toast(outcome === 'copied' ? 'Result copied – paste it in guild chat!' : outcome === 'shared' ? 'Shared!' : 'Could not share – try again');
  });
  $('btn-review').addEventListener('click', () => { $<HTMLDialogElement>('dlg-results').close(); if (game.phase === 'finished') showSummaryOnMap(); });
  $('btn-practice').addEventListener('click', () => { $<HTMLDialogElement>('dlg-results').close(); void startPractice(); });

  // Close dialogs on backdrop click.
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d =>
    d.addEventListener('click', e => { if (e.target === d) d.close(); }),
  );

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (game.phase === 'placing' && game.guess) { e.preventDefault(); void confirmGuess(); }
      else if (game.phase === 'revealed') { e.preventDefault(); void nextRound(); }
    } else if (e.key.toLowerCase() === 'h') void useHint();
  });
  document.addEventListener('pointerdown', () => void unlockAudio(), { once: true });

  countdownTimer = window.setInterval(tickCountdown, 1000);
  window.addEventListener('pagehide', () => clearInterval(countdownTimer));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

void boot();
