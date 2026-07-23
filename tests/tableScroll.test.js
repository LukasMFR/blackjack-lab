import { assert, assertEqual, test } from './runner.js';
import { scrollTableIntoView, scrollTargetY } from '../src/js/ui/tableScroll.js';

/**
 * The deal-time scroll: geometry first (where should the window land), then
 * the thin DOM wrapper, driven by a stub window so no browser is needed.
 */

/** A window just complete enough for scrollTableIntoView. */
function fakeWindow({ scrollY, innerHeight = 800, scrollHeight = 2400 }) {
  const calls = [];
  return {
    scrollY,
    scrollX: 0,
    innerHeight,
    document: { scrollingElement: { scrollHeight } },
    scrollTo: (options) => calls.push(options),
    calls,
  };
}

const tableAt = (top) => ({ getBoundingClientRect: () => ({ top }) });

test('table scroll: scrolls up when the table has been scrolled past', () => {
  // Table top 600px above the viewport top: land 12px above its edge.
  const target = scrollTargetY({ scrollY: 1000, tableTop: -600, maxScrollY: 1600 });
  assertEqual(target, 388, 'target');
});

test('table scroll: stays put when the table top is already on screen', () => {
  assertEqual(scrollTargetY({ scrollY: 0, tableTop: 40, maxScrollY: 1600 }), null, 'at the top');
  assertEqual(scrollTargetY({ scrollY: 300, tableTop: 60, maxScrollY: 1600 }), null, 'below it');
});

test('table scroll: never scrolls downward', () => {
  // The table starts below the fold: correcting to it would push the player
  // further down the page, which a new round must never do.
  assertEqual(scrollTargetY({ scrollY: 100, tableTop: 500, maxScrollY: 1600 }), null, 'downward');
});

test('table scroll: ignores negligible corrections', () => {
  assertEqual(scrollTargetY({ scrollY: 400, tableTop: -8, maxScrollY: 1600 }), null, 'tiny shift');
});

test('table scroll: never targets a position outside the document', () => {
  assertEqual(scrollTargetY({ scrollY: 500, tableTop: -900, maxScrollY: 1600 }), 0, 'clamped to 0');
});

test('table scroll: rejects a nonsensical geometry instead of guessing', () => {
  assertEqual(scrollTargetY({ scrollY: NaN, tableTop: -600, maxScrollY: 1600 }), null, 'NaN scroll');
});

test('table scroll: a scrolled-down page glides back to the table', () => {
  const win = fakeWindow({ scrollY: 1000 });
  const target = scrollTableIntoView(tableAt(-600), { win });
  assertEqual(target, 388, 'target');
  assertEqual(win.calls.length, 1, 'one scroll');
  assertEqual(win.calls[0].top, 388, 'top');
  assertEqual(win.calls[0].behavior, 'smooth', 'behavior');
  assertEqual(win.calls[0].left, 0, 'horizontal position preserved');
});

test('table scroll: reduced motion jumps instead of gliding', () => {
  const win = fakeWindow({ scrollY: 1000 });
  scrollTableIntoView(tableAt(-600), { instant: true, win });
  assertEqual(win.calls[0].behavior, 'auto', 'behavior');
  assertEqual(win.calls[0].top, 388, 'the correction still happens');
});

test('table scroll: an unscrollable page (desktop shell) never moves', () => {
  const win = fakeWindow({ scrollY: 0, innerHeight: 800, scrollHeight: 800 });
  assertEqual(scrollTableIntoView(tableAt(20), { win }), null, 'no scroll');
  assertEqual(win.calls.length, 0, 'scrollTo untouched');
});

test('table scroll: a missing table is a no-op, not a crash', () => {
  const win = fakeWindow({ scrollY: 1000 });
  assertEqual(scrollTableIntoView(null, { win }), null, 'no scroll');
  assertEqual(win.calls.length, 0, 'scrollTo untouched');
});

test('table scroll: the deal path asks for the scroll and respects motion', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/js/ui/app.js', import.meta.url), 'utf8');
  const deal = app.slice(app.indexOf('\nfunction deal()'), app.indexOf('\nfunction nextRound()'));
  assert(
    /scrollTableIntoView\(\$\('table'\), \{ instant: animations\.isMotionSuppressed\(\) \}\)/.test(deal),
    'deal() must scroll the table into view, instantly when motion is suppressed',
  );
  assert(
    deal.indexOf('renderAll()') < deal.indexOf('scrollTableIntoView'),
    'the scroll must be measured after the render',
  );
});
