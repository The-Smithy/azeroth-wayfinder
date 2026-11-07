import { emojiFor, MAX_TOTAL } from '../game/scoring';

/**
 * Spoiler-free result: date, total and one emoji per round – never the place names.
 * Ends with the site's name as plain text (no https://), so chat apps don't turn it
 * into a link with a big preview card.
 */
export function shareText(opts: { date: string | null; total: number; scores: number[]; site: string }) {
  const heading = opts.date ? `Wayfinder · ${opts.date}` : 'Wayfinder · Practice';
  return [
    `${heading} 📍 ${opts.total.toLocaleString('en-US')}/${MAX_TOTAL.toLocaleString('en-US')}`,
    opts.scores.map(emojiFor).join(''),
    opts.site,
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
