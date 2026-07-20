import { test, assert, assertEqual, assertThrows } from './runner.js';
import { qrMatrix, qrSvg } from '../src/js/multiplayer/qr.js';

/** Returns the 32 valid (masked) 15-bit format-information sequences. */
function validFormatSequences() {
  const sequences = new Set();
  for (let data = 0; data < 32; data += 1) {
    let remainder = data;
    for (let i = 0; i < 10; i += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    sequences.add(((data << 10) | remainder) ^ 0x5412);
  }
  return sequences;
}

/** Reads the format-information copy around the top-left finder pattern. */
function readFormatBits(modules) {
  const bits = [];
  for (let i = 0; i <= 5; i += 1) bits.push(modules[i][8]);
  bits.push(modules[7][8], modules[8][8], modules[8][7]);
  for (let i = 9; i < 15; i += 1) bits.push(modules[8][14 - i]);
  let value = 0;
  for (let i = 0; i < 15; i += 1) {
    if (bits[i]) value |= 1 << i;
  }
  return value;
}

/** True if the 7x7 block at (top, left) is a finder pattern. */
function hasFinderPattern(modules, top, left) {
  for (let dRow = 0; dRow < 7; dRow += 1) {
    for (let dCol = 0; dCol < 7; dCol += 1) {
      const ring = Math.max(Math.abs(dRow - 3), Math.abs(dCol - 3));
      const expected = ring !== 2;
      if (modules[top + dRow][left + dCol] !== expected) return false;
    }
  }
  return true;
}

test('qr: size is 17 + 4 x version and grows with input length', () => {
  const inputs = ['A', 'A'.repeat(40), 'A'.repeat(200), 'A'.repeat(600)];
  let previousVersion = 0;
  for (const input of inputs) {
    const { version, size, modules } = qrMatrix(input);
    assertEqual(size, 17 + 4 * version, `size for ${input.length} chars`);
    assertEqual(modules.length, size, 'row count matches size');
    for (const row of modules) {
      assertEqual(row.length, size, 'column count matches size');
    }
    assert(
      version > previousVersion,
      `version should grow: ${version} after ${previousVersion}`
    );
    previousVersion = version;
  }
});

test('qr: a short string uses version 1 (21 x 21)', () => {
  const { version, size } = qrMatrix('A');
  assertEqual(version, 1, 'version');
  assertEqual(size, 21, 'size');
});

test('qr: finder patterns sit at three corners', () => {
  const { size, modules } = qrMatrix('finder check');
  assert(hasFinderPattern(modules, 0, 0), 'top-left finder');
  assert(hasFinderPattern(modules, 0, size - 7), 'top-right finder');
  assert(hasFinderPattern(modules, size - 7, 0), 'bottom-left finder');
});

test('qr: timing patterns alternate between the finders', () => {
  const { size, modules } = qrMatrix('timing check');
  for (let i = 8; i < size - 8; i += 1) {
    assertEqual(modules[6][i], i % 2 === 0, `row timing at column ${i}`);
    assertEqual(modules[i][6], i % 2 === 0, `column timing at row ${i}`);
  }
});

test('qr: output is deterministic', () => {
  const first = qrMatrix('Blackjack Lab', { ecLevel: 'Q' });
  const second = qrMatrix('Blackjack Lab', { ecLevel: 'Q' });
  assertEqual(first.version, second.version, 'version');
  assertEqual(
    JSON.stringify(first.modules),
    JSON.stringify(second.modules),
    'modules'
  );
});

test('qr: all four EC levels work; higher EC never shrinks the version', () => {
  const input = 'x'.repeat(120);
  const versions = ['L', 'M', 'Q', 'H'].map((ecLevel) => {
    const { version, size } = qrMatrix(input, { ecLevel });
    assertEqual(size, 17 + 4 * version, `size at level ${ecLevel}`);
    return version;
  });
  for (let i = 1; i < versions.length; i += 1) {
    assert(
      versions[i] >= versions[i - 1],
      `EC order broken: ${versions.join(', ')}`
    );
  }
});

test('qr: UTF-8 input is supported', () => {
  const text = 'Déjà vu : élémentaire, chère Hélène — 21 !';
  const { version, size, modules } = qrMatrix(text, { ecLevel: 'M' });
  assertEqual(size, 17 + 4 * version, 'size');
  assertEqual(
    JSON.stringify(modules),
    JSON.stringify(qrMatrix(text, { ecLevel: 'M' }).modules),
    'deterministic for accented text'
  );
});

test('qr: throws on oversized input and bogus ecLevel', () => {
  assertThrows(
    () => qrMatrix('z'.repeat(5000), { ecLevel: 'H' }),
    'version 40',
    'oversized input should throw'
  );
  assertThrows(
    () => qrMatrix('hello', { ecLevel: 'X' }),
    'ecLevel',
    'bogus ecLevel should throw'
  );
});

test('qr: qrSvg produces a scalable SVG with a quiet zone', () => {
  const svg = qrSvg('svg check');
  assert(typeof svg === 'string' && svg.includes('<svg'), 'is an <svg> string');
  assert(svg.includes('viewBox'), 'has a viewBox');
  assert(svg.includes('currentColor'), 'uses currentColor');
  assert(svg.includes('crispEdges'), 'uses crispEdges');

  const { size } = qrMatrix('svg check');
  assert(
    svg.includes(`viewBox="0 0 ${size + 8} ${size + 8}"`),
    'default margin of 4 modules on each side'
  );
  const tight = qrSvg('svg check', { margin: 0 });
  assert(
    tight.includes(`viewBox="0 0 ${size} ${size}"`),
    'margin 0 shrinks the viewBox'
  );
});

test('qr: format information is a valid BCH sequence and dark module is set', () => {
  for (const ecLevel of ['L', 'M', 'Q', 'H']) {
    const { version, modules } = qrMatrix('OK', { ecLevel });
    const formatValue = readFormatBits(modules);
    assert(
      validFormatSequences().has(formatValue),
      `format bits ${formatValue.toString(2)} invalid at level ${ecLevel}`
    );
    assertEqual(
      modules[4 * version + 9][8],
      true,
      `dark module at level ${ecLevel}`
    );
  }
});
