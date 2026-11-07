import { emojiFor, MAX_TOTAL } from '../game/scoring';

export function shareText(opts: { day: number | null; total: number; scores: number[]; url: string }) {
  const heading = opts.day ? `Azeroth Pinpoint #${opts.day}` : 'Azeroth Pinpoint · Practice';
  return [
    `${heading} 📍 ${opts.total.toLocaleString('en-US')}/${MAX_TOTAL.toLocaleString('en-US')}`,
    opts.scores.map(emojiFor).join(''),
    opts.url,
  ].join('\n');
}

/** Native share sheet on phones, clipboard elsewhere. Returns what happened. */
export async function shareResult(text: string): Promise<'shared' | 'copied' | 'failed'> {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.share) {
    try { await navigator.share({ text }); return 'shared'; } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'failed';
    }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { /* fall through */ }
  const area = Object.assign(document.createElement('textarea'), { value: text });
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok ? 'copied' : 'failed';
}
