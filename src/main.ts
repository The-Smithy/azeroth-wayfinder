import 'leaflet/dist/leaflet.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './styles/main.css';

import { gsap } from 'gsap';
import locations from './data/locations.json';
import zonesJson from './data/zones.json';
import type { LatLngTuple, MapManifest, Place, RoundResult, Zone } from './types';
import { dailyPlaces, dayNumber, msUntilNextDay, practicePlaces } from './game/daily';
import { formatYards, measure, ROUNDS, scoreFor, titleFor, emojiFor } from './game/scoring';
import { liveStreak, loadProgress, loadSettings, loadStats, recordGame, saveProgress, saveSettings, type Settings } from './game/storage';
import { MapView, type MapStyle } from './map/mapView';
import { crest, factionLabels, icons, kindIcons, kindLabels, shield } from './ui/icons';
import { play, setSoundEnabled, soundForScore, unlockAudio } from './ui/sound';
import { celebrate, startEmbers } from './ui/fx';
import { shareResult, shareText } from './ui/share';

const places = locations as Place[];
const zones = zonesJson as unknown as Record<string, Zone>;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ state ----
type Phase = 'placing' | 'revealed' | 'finished';
interface Game {
  mode: 'daily' | 'practice';
  day: number;
  places: Place[];
  rounds: RoundResult[];
  current: number;
  phase: Phase;
  guess: LatLngTuple | null;
  hint: boolean;
}

const settings: Settings = loadSettings();
const today = dayNumber();
let game: Game;
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
    $('loader-text').innerHTML = 'The map could not be found.<br><small>Run <code>npm run fetch-map</code> to download the imagery.</small>';
    $('loader').classList.add('is-error');
    return;
  }

  view = new MapView($('map'), manifest, zones);
  view.setStyle(settings.mapStyle);
  view.setZoneOutline(settings.zoneLabels);
  view.onPick = pick;
  view.onHover = ({ zone, coords }) => {
    const box = $('readout');
    box.classList.toggle('is-visible', !!zone && settings.zoneLabels);
    $('readout-zone').textContent = zone ?? '';
    $('readout-coords').textContent = coords ? `${coords[0].toFixed(1)}, ${coords[1].toFixed(1)}` : '';
  };

  try { await view.ready(); } catch { /* the terrain still works without the parchment */ }
  wireControls();
  startDaily();
  if (import.meta.env.DEV) Object.assign(window, { __pinpoint: { view, get game() { return game; } } });

  const loader = $('loader');
  gsap.to(loader, { opacity: 0, duration: reduced() ? 0 : 0.8, delay: 0.2, onComplete: () => loader.remove() });
  void startEmbers('embers');
  if (!settings.seenHelp) {
    settings.seenHelp = true;
    saveSettings(settings);
    setTimeout(() => openDialog('dlg-help'), 700);
  }
}

// --------------------------------------------------------------- flow -------
function startDaily() {
  const progress = loadProgress(today);
  game = {
    mode: 'daily', day: today, places: dailyPlaces(places, today),
    rounds: progress.rounds.slice(0, ROUNDS), current: 0, phase: 'placing', guess: null, hint: false,
  };
  game.current = game.rounds.length;
  $('puzzle-label').textContent = `Daily expedition #${today} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  document.body.classList.remove('is-practice');
  renderPips();
  updateTotal(false);
  if (game.current >= ROUNDS) finish(false);
  else startRound();
}

function startPractice() {
  game = { mode: 'practice', day: 0, places: practicePlaces(places), rounds: [], current: 0, phase: 'placing', guess: null, hint: false };
  $('puzzle-label').textContent = 'Practice expedition · not counted';
  document.body.classList.add('is-practice');
  renderPips();
  updateTotal(false);
  view.home();
  startRound();
}

function startRound() {
  const place = game.places[game.current];
  game.phase = 'placing';
  game.guess = null;
  game.hint = false;
  view.clearRound();

  $('clue-kind').innerHTML = `${kindIcons[place.kind]}<span>${kindLabels[place.kind]}</span>`;
  const faction = $('clue-faction');
  faction.hidden = place.kind === 'zone' || place.kind === 'dungeon' || place.kind === 'raid';
  faction.innerHTML = `${shield(place.faction)}<span>${factionLabels[place.faction]}</span>`;
  $('clue-round').textContent = `Location ${game.current + 1} of ${ROUNDS}`;
  setName(place.name);
  $('clue-prompt').textContent = place.area
    ? 'Drop your pin anywhere inside it.'
    : place.kind === 'dungeon' || place.kind === 'raid'
      ? 'Drop your pin on the entrance.'
      : 'Drop your pin where you think it lies.';
  $('result').hidden = true;
  $('btn-next').hidden = true;
  $('btn-hint').hidden = false;
  ($('btn-hint') as HTMLButtonElement).disabled = false;
  const confirm = $('btn-confirm') as HTMLButtonElement;
  confirm.hidden = false;
  confirm.disabled = true;
  confirm.textContent = 'Drop a pin on the map';
  $('card').classList.remove('is-revealed', 'is-finished');
  renderPips();

  if (!reduced()) {
    gsap.fromTo('#card .card__frame', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'power3.out' });
  }
}

function setName(name: string) {
  const el = $('clue-name');
  el.innerHTML = [...name].map(ch => `<span class="ch">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`).join('');
  if (!reduced()) gsap.from(el.querySelectorAll('.ch'), { opacity: 0, y: 8, filter: 'blur(4px)', duration: 0.4, stagger: 0.022, ease: 'power2.out' });
}

function pick(latlng: LatLngTuple) {
  if (game.phase !== 'placing') return;
  void unlockAudio();
  const first = !game.guess;
  game.guess = latlng;
  view.placeGuess(latlng);
  play('drop');
  const confirm = $('btn-confirm') as HTMLButtonElement;
  confirm.disabled = false;
  confirm.textContent = 'Confirm pin';
  if (first && !reduced()) gsap.fromTo(confirm, { scale: 0.94 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
}

function useHint() {
  if (game.phase !== 'placing' || game.hint) return;
  const place = game.places[game.current];
  game.hint = true;
  play('hint');
  ($('btn-hint') as HTMLButtonElement).disabled = true;
  $('clue-prompt').innerHTML = `<span class="hint-text">${kindIcons.zone} Somewhere in <strong>${place.continent}</strong>.</span>`;
  view.focusContinent(place.continent);
}

async function confirmGuess() {
  if (game.phase !== 'placing' || !game.guess) return;
  game.phase = 'revealed';
  const place = game.places[game.current];
  const guess = game.guess;
  const { yards, anchor } = measure(guess, place, zones);
  const score = scoreFor(yards, game.hint);
  const result: RoundResult = { placeId: place.id, guess, yards: Math.round(yards), score, hint: game.hint };
  game.rounds.push(result);
  persist();

  $('btn-confirm').hidden = true;
  $('btn-hint').hidden = true;
  play('whoosh');
  await view.reveal(guess, anchor, place, yards ? formatYards(yards) : '');

  play(soundForScore(score));
  if (score >= 950) celebrate();
  $('card').classList.add('is-revealed');
  $('result').hidden = false;
  $('clue-prompt').textContent = '';
  $('result-distance').textContent = yards === 0 ? (place.area ? 'Right inside – bullseye!' : 'Bullseye!') : `${formatYards(yards)} away`;
  $('result-where').innerHTML = `${escapeHtml(place.zone === place.name ? place.continent : `${place.zone}, ${place.continent}`)}${game.hint ? ' · <em>hint used</em>' : ''}`;
  countUp($('result-score'), 0, score, 0.9);
  if (!reduced()) gsap.fromTo('#result', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 });
  renderPips();
  updateTotal(true);

  game.current++;
  const next = $('btn-next');
  next.hidden = false;
  next.textContent = game.current >= ROUNDS ? 'See your results ▸' : 'Next location ▸';
  next.focus({ preventScroll: true });
}

function nextRound() {
  if (game.phase !== 'revealed') return;
  play('click');
  if (game.current >= ROUNDS) { finish(true); return; }
  view.home();
  startRound();
}

function persist() {
  if (game.mode === 'daily') saveProgress({ day: game.day, rounds: game.rounds });
}

function finish(fresh: boolean) {
  game.phase = 'finished';
  const total = game.rounds.reduce((s, r) => s + r.score, 0);
  if (game.mode === 'daily') recordGame(game.day, total);
  showSummaryOnMap();
  $('card').classList.add('is-finished');
  $('clue-kind').innerHTML = `${kindIcons.landmark}<span>${game.mode === 'daily' ? `Expedition #${game.day}` : 'Practice'}</span>`;
  $('clue-faction').hidden = true;
  $('clue-round').textContent = 'Complete';
  setName(`${total.toLocaleString('en-US')} points`);
  $('clue-prompt').textContent = game.rounds.map(r => emojiFor(r.score)).join(' ');
  $('result').hidden = true;
  $('btn-hint').hidden = true;
  $('btn-confirm').hidden = true;
  const next = $('btn-next');
  next.hidden = false;
  next.textContent = 'Show results';
  renderPips();
  updateTotal(false);
  openResults(fresh);
  if (fresh) {
    play('fanfare');
    if (total >= 4000) celebrate(true);
  }
}

function showSummaryOnMap() {
  view.showSummary(game.rounds.map((r, i) => {
    const place = game.places[i];
    return { guess: r.guess, anchor: measure(r.guess, place, zones).anchor, place };
  }));
}

// ------------------------------------------------------------- render -------
function renderPips() {
  const ol = $('pips');
  ol.innerHTML = game.places.map((p, i) => {
    const r = game.rounds[i];
    const cls = r ? `pip is-done pip--${tier(r.score)}` : i === game.current && game.phase !== 'finished' ? 'pip is-current' : 'pip';
    const label = r ? `${p.name}: ${r.score} points` : i === game.current ? 'Current location' : 'Upcoming';
    return `<li class="${cls}" title="${escapeHtml(label)}"><span class="pip__gem"></span><span class="pip__score">${r ? r.score : i + 1}</span></li>`;
  }).join('');
}
const tier = (s: number) => (s >= 950 ? 'perfect' : s >= 750 ? 'great' : s >= 500 ? 'good' : s >= 250 ? 'poor' : 'miss');

let shownTotal = 0;
function updateTotal(animate: boolean) {
  const total = game.rounds.reduce((s, r) => s + r.score, 0);
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

function openResults(fresh: boolean) {
  const total = game.rounds.reduce((s, r) => s + r.score, 0);
  const [, title, flavor] = titleFor(total);
  $('results-kicker').textContent = game.mode === 'daily' ? `Expedition #${game.day} complete` : 'Practice complete';
  $('results-title').textContent = title;
  $('results-flavor').textContent = flavor;
  $('results-rounds').innerHTML = game.rounds.map((r, i) => {
    const p = game.places[i];
    return `<li class="round round--${tier(r.score)}">
      <span class="round__emoji">${emojiFor(r.score)}</span>
      <span class="round__name">${escapeHtml(p.name)}<small>${kindLabels[p.kind]} · ${escapeHtml(p.zone === p.name ? p.continent : p.zone)}</small></span>
      <span class="round__dist">${r.yards === 0 ? 'Bullseye' : formatYards(r.yards)}${r.hint ? ' · hint' : ''}</span>
      <span class="round__score">${r.score}</span>
    </li>`;
  }).join('');
  renderStats();
  $('next-wrap').hidden = game.mode !== 'daily';
  $('btn-practice').textContent = game.mode === 'daily' ? 'Practice with random places' : 'Another practice run';
  openDialog('dlg-results');
  const totalEl = $('results-total');
  if (fresh) countUp(totalEl, 0, total, 1.6);
  else totalEl.textContent = total.toLocaleString('en-US');
  if (!reduced()) gsap.from('#results-rounds .round', { x: -16, opacity: 0, stagger: 0.08, duration: 0.4, delay: 0.15 });
}

function renderStats() {
  const s = loadStats();
  const avg = s.played ? Math.round(s.totalScore / s.played) : 0;
  const max = Math.max(1, ...s.buckets);
  $('stats').innerHTML = `
    <div class="stats__grid">
      <div><strong>${s.played}</strong><span>Played</span></div>
      <div><strong>${avg.toLocaleString('en-US')}</strong><span>Average</span></div>
      <div><strong>${s.best.toLocaleString('en-US')}</strong><span>Best</span></div>
      <div><strong>${liveStreak(s, today)}</strong><span>Streak</span></div>
      <div><strong>${s.maxStreak}</strong><span>Max streak</span></div>
    </div>
    <div class="stats__bars" aria-label="Score distribution">
      ${s.buckets.map((n, i) => `<div class="bar"><span class="bar__label">${i}k+</span><span class="bar__track"><span class="bar__fill" style="--w:${(n / max) * 100}%">${n}</span></span></div>`).join('')}
    </div>`;
}

// ------------------------------------------------------------- dialogs ------
function openDialog(id: string) {
  const dlg = $<HTMLDialogElement>(id);
  if (dlg.open) return;
  dlg.showModal();
  if (!reduced()) gsap.fromTo(dlg.querySelector('.modal__frame'), { y: 24, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' });
}

let countdownTimer = 0;
function tickCountdown() {
  const ms = msUntilNextDay();
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
  $('countdown').textContent = [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  if (dayNumber() !== today && game.mode === 'daily') location.reload();
}

function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el.classList.remove('is-visible'), 2200);
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
  $('btn-next').addEventListener('click', () => (game.phase === 'finished' ? openResults(false) : nextRound()));
  $('btn-hint').addEventListener('click', useHint);
  $('btn-help').addEventListener('click', () => { play('click'); openDialog('dlg-help'); });
  $('btn-stats').addEventListener('click', () => {
    play('click');
    if (game.phase === 'finished') openResults(false);
    else { renderStats(); $('results-rounds').innerHTML = ''; $('results-kicker').textContent = 'Your record'; $('results-title').textContent = 'Statistics'; $('results-flavor').textContent = 'Finish today\'s expedition to see your score here.'; $('results-total').textContent = game.rounds.reduce((s, r) => s + r.score, 0).toLocaleString('en-US'); openDialog('dlg-results'); }
  });
  $('btn-settings').addEventListener('click', () => {
    play('click');
    ($('set-sound') as HTMLInputElement).checked = settings.sound;
    ($('set-zones') as HTMLInputElement).checked = settings.zoneLabels;
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
    const total = game.rounds.reduce((s, r) => s + r.score, 0);
    const text = shareText({ day: game.mode === 'daily' ? game.day : null, total, scores: game.rounds.map(r => r.score), url: location.origin });
    const outcome = await shareResult(text);
    toast(outcome === 'copied' ? 'Result copied – paste it in guild chat!' : outcome === 'shared' ? 'Shared!' : 'Could not share – try again');
  });
  $('btn-review').addEventListener('click', () => { $<HTMLDialogElement>('dlg-results').close(); if (game.phase === 'finished') showSummaryOnMap(); });
  $('btn-practice').addEventListener('click', () => { $<HTMLDialogElement>('dlg-results').close(); startPractice(); });

  // Close dialogs on backdrop click.
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d =>
    d.addEventListener('click', e => { if (e.target === d) d.close(); }),
  );

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (game.phase === 'placing' && game.guess) { e.preventDefault(); void confirmGuess(); }
      else if (game.phase === 'revealed') { e.preventDefault(); nextRound(); }
    } else if (e.key.toLowerCase() === 'h') useHint();
  });
  document.addEventListener('pointerdown', () => void unlockAudio(), { once: true });

  tickCountdown();
  countdownTimer = window.setInterval(tickCountdown, 1000);
  window.addEventListener('pagehide', () => clearInterval(countdownTimer));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

void boot();
