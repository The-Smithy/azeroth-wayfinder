import type { Faction, LocationKind } from '../types';

const svg = (body: string, view = '0 0 24 24') =>
  `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;

export const kindIcons: Record<LocationKind, string> = {
  city: svg('<path d="M3 21V10l2-1V6h2v2l2-1V4h2v3l1-.5L13 7V4h2v3l2 1V6h2v3l2 1v11h-7v-5a2 2 0 0 0-4 0v5z" fill="currentColor"/>'),
  town: svg('<path d="M2 12 12 4l10 8h-3v9h-5v-6h-4v6H5v-9z" fill="currentColor"/>'),
  dungeon: svg('<path d="M12 3a8 8 0 0 0-8 8v3l2 2v4h3v-2h2v2h2v-2h2v2h3v-4l2-2v-3a8 8 0 0 0-8-8Zm-3.5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" fill="currentColor"/>'),
  raid: svg('<path d="m3 6 4 3 5-6 5 6 4-3-2 11H5zM5 19h14v2H5z" fill="currentColor"/>'),
  zone: svg('<path d="m2 20 7-12 4 6 3-4 6 10z" fill="currentColor"/><circle cx="17" cy="5" r="2" fill="currentColor"/>'),
  landmark: svg('<path d="M6 21v-2h1V9H6V7l6-4 6 4v2h-1v10h1v2zm4-12v10h4V9z" fill="currentColor"/>'),
};

export const kindLabels: Record<LocationKind, string> = {
  city: 'Capital city',
  town: 'Settlement',
  dungeon: 'Dungeon entrance',
  raid: 'Raid entrance',
  zone: 'Zone',
  landmark: 'Landmark',
};

export const factionLabels: Record<Faction, string> = { alliance: 'Alliance', horde: 'Horde', neutral: 'Neutral' };

export const shield = (faction: Faction) =>
  `<span class="crest crest--${faction}">${svg('<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="currentColor"/><path d="M12 6v12M8 10h8" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>')}</span>`;

export const icons = {
  help: svg('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 16h-2v-2h2zm2.1-7.7-.9.9A3.4 3.4 0 0 0 13 14h-2v-.5a4 4 0 0 1 1.2-2.8l1.2-1.3A2 2 0 1 0 10 8H8a4 4 0 1 1 7.1 2.3Z" fill="currentColor"/>'),
  stats: svg('<path d="M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z" fill="currentColor"/>'),
  gear: svg('<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.4-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" fill="currentColor" transform="translate(-1 0)"/>'),
  plus: svg('<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor"/>'),
  minus: svg('<path d="M5 11h14v2H5z" fill="currentColor"/>'),
  home: svg('<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2.2 1.6 5.2L19 12l-5.4 1.6L12 19l-1.6-5.4L5 12l5.4-1.6z" fill="currentColor"/>'),
  layers: svg('<path d="m12 3 10 5-10 5L2 8zm-7.6 8.3L12 15l7.6-3.7L22 12.5 12 17.5 2 12.5zm0 4.5L12 19.5l7.6-3.7L22 17l-10 5-10-5z" fill="currentColor"/>'),
  sound: svg('<path d="M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.8v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" fill="currentColor"/>'),
  mute: svg('<path d="M4 9h4l5-4v14l-5-4H4zm12.6.4 1.4-1.4 2 2 2-2 1.4 1.4-2 2 2 2-1.4 1.4-2-2-2 2-1.4-1.4 2-2z" fill="currentColor"/>'),
  share: svg('<path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1Z" fill="currentColor"/>'),
  compass: svg('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 6.5-2 5-5 2 2-5z" fill="currentColor"/>'),
  close: svg('<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" fill="currentColor"/>'),
};

/** The game's crest: a compass rose over a map pin. Original art. */
export const crest = svg(
  `<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6a8"/><stop offset=".5" stop-color="#d9a441"/><stop offset="1" stop-color="#7a5418"/></linearGradient></defs>
   <circle cx="32" cy="32" r="29" fill="#1a120a" stroke="url(#cg)" stroke-width="3"/>
   <circle cx="32" cy="32" r="22" fill="none" stroke="#d9a441" stroke-opacity=".45" stroke-dasharray="2 3"/>
   <path d="M32 6 36 28 58 32 36 36 32 58 28 36 6 32 28 28z" fill="url(#cg)" opacity=".9"/>
   <path d="M32 18c-5.5 0-9.5 4-9.5 9.3C22.5 34 32 44 32 44s9.5-10 9.5-16.7c0-5.3-4-9.3-9.5-9.3Z" fill="#b3262e" stroke="#ffe6a8" stroke-width="1.6"/>
   <circle cx="32" cy="27.5" r="3.4" fill="#ffe6a8"/>`,
  '0 0 64 64',
);

export const guessPinSvg = svg(
  `<defs><linearGradient id="gp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c2"/><stop offset=".45" stop-color="#e3b04b"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>
   <radialGradient id="gem" cx=".35" cy=".35"><stop offset="0" stop-color="#bff4ff"/><stop offset=".5" stop-color="#2fa3d6"/><stop offset="1" stop-color="#0b3d63"/></radialGradient></defs>
   <path d="M20 2C10.6 2 4 8.8 4 17.6 4 29 20 46 20 46s16-17 16-28.4C36 8.8 29.4 2 20 2Z" fill="url(#gp)" stroke="#3b2405" stroke-width="2"/>
   <circle cx="20" cy="17" r="7.5" fill="url(#gem)" stroke="#3b2405" stroke-width="1.5"/>`,
  '0 0 40 48',
);

export const targetPinSvg = svg(
  `<path d="M9 46V4" stroke="#2b1a0a" stroke-width="3" stroke-linecap="round"/>
   <path d="M10 5h24l-6 8 6 8H10z" fill="#b3262e" stroke="#2b1a0a" stroke-width="2" stroke-linejoin="round"/>
   <path d="M15 9l2.5 4L15 17" stroke="#ffd98a" stroke-width="2" fill="none"/>
   <circle cx="9" cy="4" r="3" fill="#ffd98a" stroke="#2b1a0a" stroke-width="1.5"/>`,
  '0 0 40 48',
);
