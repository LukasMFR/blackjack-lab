/**
 * QR code encoder — implements ISO/IEC 18004, byte mode only.
 *
 * Pure computation: no DOM access, no Node APIs, no randomness, no clock.
 * Encodes arbitrary UTF-8 text into a QR module matrix (versions 1-40,
 * error-correction levels L/M/Q/H) with spec-correct Reed-Solomon error
 * correction over GF(256), per-version block interleaving, all eight data
 * masks with standard penalty evaluation, BCH-protected format information,
 * and version information for versions 7 and above.
 *
 * Public API: qrMatrix(text, options) and qrSvg(text, options).
 */

// ---------------------------------------------------------------------------
// Spec constants
// ---------------------------------------------------------------------------

const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** Mode indicator for byte mode (ISO/IEC 18004 table 2). */
const BYTE_MODE_INDICATOR = 0b0100;

/** Codewords alternated to pad unused data capacity (11101100, 00010001). */
const PAD_CODEWORDS = [0xec, 0x11];

/** Error-correction level indicator bits for format information (table 25). */
const EC_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/** BCH(15,5) generator polynomial for format information. */
const FORMAT_GENERATOR = 0x537;

/** XOR mask applied to the 15 format-information bits. */
const FORMAT_MASK = 0x5412;

/** BCH(18,6) generator polynomial for version information. */
const VERSION_GENERATOR = 0x1f25;

/** First version that carries version-information blocks. */
const FIRST_VERSION_WITH_VERSION_INFO = 7;

/** GF(256) primitive polynomial x^8 + x^4 + x^3 + x^2 + 1. */
const GF_PRIMITIVE = 0x11d;

/** Penalty weights for mask evaluation (ISO/IEC 18004 table 24). */
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * Error-correction codewords per block, indexed by [ecLevel][version - 1].
 * Values from the ISO/IEC 18004 error-correction characteristics table.
 */
const EC_CODEWORDS_PER_BLOCK = {
  L: [
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
    28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
  ],
  M: [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
    26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28,
  ],
  Q: [
    13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26,
    30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
  ],
  H: [
    17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26,
    28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
  ],
};

/**
 * Number of error-correction blocks, indexed by [ecLevel][version - 1].
 * Values from the ISO/IEC 18004 error-correction characteristics table.
 * Where the standard table splits a version into two block groups, the data
 * lengths of the groups always differ by exactly one codeword, so the group
 * split is recovered arithmetically in splitIntoBlocks().
 */
const EC_BLOCK_COUNT = {
  L: [
    1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
    12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
    18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23,
    23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25,
    34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

/**
 * Alignment-pattern centre coordinates, indexed by version - 1.
 * Taken directly from the ISO/IEC 18004 alignment-pattern table (annex E).
 */
const ALIGNMENT_POSITIONS = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

/**
 * Data-mask predicates (ISO/IEC 18004 table 23). `row`/`col` are module
 * coordinates; a true result means the module colour is inverted.
 */
const MASK_PREDICATES = [
  (row, col) => (row + col) % 2 === 0,
  (row, col) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

// ---------------------------------------------------------------------------
// GF(256) arithmetic (for Reed-Solomon error correction)
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(510);
const GF_LOG = new Uint8Array(256);

{
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    GF_EXP[power] = value;
    GF_LOG[value] = power;
    value <<= 1;
    if (value & 0x100) value ^= GF_PRIMITIVE;
  }
  for (let power = 255; power < 510; power += 1) {
    GF_EXP[power] = GF_EXP[power - 255];
  }
}

/** Multiplies two elements of GF(256). */
function gfMultiply(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Builds the Reed-Solomon generator polynomial of the given degree:
 * the product of (x - alpha^i) for i = 0 .. degree - 1. Returns the
 * coefficient array [1, g1, ..., gDegree] from highest to lowest power.
 */
function reedSolomonGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const root = GF_EXP[i];
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMultiply(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

/**
 * Computes the Reed-Solomon remainder of `data` (message codewords) divided
 * by the monic generator polynomial. The remainder is the block's
 * error-correction codewords.
 */
function reedSolomonRemainder(data, generator) {
  const degree = generator.length - 1;
  const remainder = new Array(degree).fill(0);
  for (const codeword of data) {
    const factor = codeword ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) {
      remainder[i] ^= gfMultiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Capacity and version selection
// ---------------------------------------------------------------------------

/**
 * Total codewords available in a version, from the spec capacity formula:
 * (total modules - function and format/version modules) / 8.
 */
function totalCodewords(version) {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    bits -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= FIRST_VERSION_WITH_VERSION_INFO) bits -= 36;
  }
  return Math.floor(bits / 8);
}

/** Data codewords (total minus error correction) for a version and level. */
function dataCodewordCount(version, ecLevel) {
  const blocks = EC_BLOCK_COUNT[ecLevel][version - 1];
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[ecLevel][version - 1];
  return totalCodewords(version) - blocks * ecPerBlock;
}

/** Character-count indicator width for byte mode (spec table 3). */
function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

/** Smallest version whose byte-mode data capacity fits `byteLength` bytes. */
function selectVersion(byteLength, ecLevel) {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    const headerBits = 4 + charCountBits(version);
    const capacityBits = dataCodewordCount(version, ecLevel) * 8;
    if (headerBits + byteLength * 8 <= capacityBits) return version;
  }
  throw new Error(
    `Data too long: ${byteLength} bytes do not fit in QR version ${MAX_VERSION} ` +
      `at error-correction level ${ecLevel}.`
  );
}

// ---------------------------------------------------------------------------
// Data encoding
// ---------------------------------------------------------------------------

/** Appends `count` bits of `value` (most significant first) to `bits`. */
function appendBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

/**
 * Builds the data codewords for one byte-mode segment: mode indicator,
 * character count, data bytes, terminator, bit padding, and pad codewords.
 */
function buildDataCodewords(bytes, version, ecLevel) {
  const capacityBits = dataCodewordCount(version, ecLevel) * 8;
  const bits = [];
  appendBits(bits, BYTE_MODE_INDICATOR, 4);
  appendBits(bits, bytes.length, charCountBits(version));
  for (const byte of bytes) appendBits(bits, byte, 8);

  const terminatorBits = Math.min(4, capacityBits - bits.length);
  appendBits(bits, 0, terminatorBits);
  if (bits.length % 8 !== 0) appendBits(bits, 0, 8 - (bits.length % 8));

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  let padIndex = 0;
  while (codewords.length * 8 < capacityBits) {
    codewords.push(PAD_CODEWORDS[padIndex]);
    padIndex ^= 1;
  }
  return codewords;
}

/**
 * Splits the data codewords into the version's RS blocks, computes each
 * block's error-correction codewords, and interleaves everything into the
 * final codeword sequence (data columns first, then EC columns).
 */
function interleaveWithErrorCorrection(dataCodewords, version, ecLevel) {
  const blockCount = EC_BLOCK_COUNT[ecLevel][version - 1];
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[ecLevel][version - 1];
  const total = totalCodewords(version);
  const shortBlockTotalLength = Math.floor(total / blockCount);
  const shortBlockCount = blockCount - (total % blockCount);
  const generator = reedSolomonGenerator(ecPerBlock);

  const blocks = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i += 1) {
    const dataLength =
      shortBlockTotalLength - ecPerBlock + (i < shortBlockCount ? 0 : 1);
    const blockData = dataCodewords.slice(offset, offset + dataLength);
    offset += dataLength;
    blocks.push({
      data: blockData,
      ec: reedSolomonRemainder(blockData, generator),
    });
  }

  const interleaved = [];
  const longestDataLength = shortBlockTotalLength - ecPerBlock + 1;
  for (let i = 0; i < longestDataLength; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) interleaved.push(block.data[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of blocks) interleaved.push(block.ec[i]);
  }
  return interleaved;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

/** Creates a size x size grid filled with `value`. */
function createGrid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value));
}

/**
 * Draws one finder pattern (with its light separator) centred at
 * (centerRow, centerCol), clipped to the matrix bounds.
 */
function drawFinderPattern(modules, isFunction, size, centerRow, centerCol) {
  for (let dRow = -4; dRow <= 4; dRow += 1) {
    for (let dCol = -4; dCol <= 4; dCol += 1) {
      const row = centerRow + dRow;
      const col = centerCol + dCol;
      if (row < 0 || row >= size || col < 0 || col >= size) continue;
      const distance = Math.max(Math.abs(dRow), Math.abs(dCol));
      modules[row][col] = distance !== 2 && distance !== 4;
      isFunction[row][col] = true;
    }
  }
}

/** Draws one 5x5 alignment pattern centred at (centerRow, centerCol). */
function drawAlignmentPattern(modules, isFunction, centerRow, centerCol) {
  for (let dRow = -2; dRow <= 2; dRow += 1) {
    for (let dCol = -2; dCol <= 2; dCol += 1) {
      const distance = Math.max(Math.abs(dRow), Math.abs(dCol));
      modules[centerRow + dRow][centerCol + dCol] = distance !== 1;
      isFunction[centerRow + dRow][centerCol + dCol] = true;
    }
  }
}

/**
 * Draws the two copies of the 15-bit format information (EC level + mask,
 * BCH protected, masked with FORMAT_MASK) and the fixed dark module.
 */
function drawFormatInformation(modules, isFunction, size, ecLevel, mask) {
  const data = (EC_LEVEL_BITS[ecLevel] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * FORMAT_GENERATOR);
  }
  const formatBits = ((data << 10) | remainder) ^ FORMAT_MASK;

  const setModule = (row, col, dark) => {
    modules[row][col] = dark;
    isFunction[row][col] = true;
  };
  const bit = (index) => ((formatBits >>> index) & 1) === 1;

  // First copy, around the top-left finder pattern.
  for (let i = 0; i <= 5; i += 1) setModule(i, 8, bit(i));
  setModule(7, 8, bit(6));
  setModule(8, 8, bit(7));
  setModule(8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) setModule(8, 14 - i, bit(i));

  // Second copy, split under the top-right and beside the bottom-left finder.
  for (let i = 0; i < 8; i += 1) setModule(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i += 1) setModule(size - 15 + i, 8, bit(i));

  // The module above the bottom-left format copy is always dark.
  setModule(size - 8, 8, true);
}

/**
 * Draws the two 3x6 version-information blocks (18 bits, BCH protected)
 * for versions 7 and above.
 */
function drawVersionInformation(modules, isFunction, size, version) {
  if (version < FIRST_VERSION_WITH_VERSION_INFO) return;
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * VERSION_GENERATOR);
  }
  const versionBits = (version << 12) | remainder;

  for (let i = 0; i < 18; i += 1) {
    const dark = ((versionBits >>> i) & 1) === 1;
    const longAxis = size - 11 + (i % 3);
    const shortAxis = Math.floor(i / 3);
    modules[shortAxis][longAxis] = dark;
    isFunction[shortAxis][longAxis] = true;
    modules[longAxis][shortAxis] = dark;
    isFunction[longAxis][shortAxis] = true;
  }
}

/**
 * Draws every function pattern: timing, finders, alignment, format and
 * version areas. Format information is drawn with mask 0 as a placeholder so
 * its modules are reserved; the real mask is written after mask selection.
 */
function drawFunctionPatterns(modules, isFunction, size, version, ecLevel) {
  // Timing patterns on row 6 and column 6.
  for (let i = 0; i < size; i += 1) {
    const dark = i % 2 === 0;
    modules[6][i] = dark;
    isFunction[6][i] = true;
    modules[i][6] = dark;
    isFunction[i][6] = true;
  }

  drawFinderPattern(modules, isFunction, size, 3, 3);
  drawFinderPattern(modules, isFunction, size, 3, size - 4);
  drawFinderPattern(modules, isFunction, size, size - 4, 3);

  const positions = ALIGNMENT_POSITIONS[version - 1];
  const last = positions.length - 1;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const overlapsFinder =
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0);
      if (overlapsFinder) continue;
      drawAlignmentPattern(modules, isFunction, positions[i], positions[j]);
    }
  }

  drawFormatInformation(modules, isFunction, size, ecLevel, 0);
  drawVersionInformation(modules, isFunction, size, version);
}

/**
 * Places the interleaved codeword bits into the matrix in the standard
 * zigzag order: column pairs from right to left (skipping the timing
 * column), alternating upward and downward. Leftover remainder modules
 * stay light.
 */
function placeCodewords(modules, isFunction, size, codewords) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let colOffset = 0; colOffset < 2; colOffset += 1) {
        const col = right - colOffset;
        if (isFunction[row][col] || bitIndex >= totalBits) continue;
        const byte = codewords[bitIndex >>> 3];
        modules[row][col] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
  }
}

/** XORs the given mask pattern onto every non-function module. */
function applyMask(modules, isFunction, size, mask) {
  const predicate = MASK_PREDICATES[mask];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!isFunction[row][col] && predicate(row, col)) {
        modules[row][col] = !modules[row][col];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mask penalty evaluation (ISO/IEC 18004 rules N1-N4)
// ---------------------------------------------------------------------------

/** N1 contribution of one line: runs of 5+ same-colour modules. */
function linearRunPenalty(line) {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;
  for (let i = 1; i <= line.length; i += 1) {
    if (i < line.length && line[i] === runColor) {
      runLength += 1;
      continue;
    }
    if (runLength >= 5) penalty += PENALTY_N1 + (runLength - 5);
    if (i < line.length) {
      runColor = line[i];
      runLength = 1;
    }
  }
  return penalty;
}

/** True if `line` contains 1011101 starting at `start`. */
function isFinderRun(line, start) {
  return (
    line[start] &&
    !line[start + 1] &&
    line[start + 2] &&
    line[start + 3] &&
    line[start + 4] &&
    !line[start + 5] &&
    line[start + 6]
  );
}

/** True if the four modules starting at `start` are all light. */
function isLightRun(line, start) {
  return (
    !line[start] && !line[start + 1] && !line[start + 2] && !line[start + 3]
  );
}

/** N3 contribution of one line: 1011101 adjacent to 0000. */
function finderLikePenalty(line) {
  let penalty = 0;
  for (let i = 0; i + 11 <= line.length; i += 1) {
    if (isFinderRun(line, i) && isLightRun(line, i + 7)) penalty += PENALTY_N3;
    if (isLightRun(line, i) && isFinderRun(line, i + 4)) penalty += PENALTY_N3;
  }
  return penalty;
}

/** Total penalty score of a fully drawn matrix. */
function penaltyScore(modules, size) {
  let penalty = 0;
  let darkCount = 0;

  for (let row = 0; row < size; row += 1) {
    const line = modules[row];
    penalty += linearRunPenalty(line) + finderLikePenalty(line);
    for (let col = 0; col < size; col += 1) {
      if (line[col]) darkCount += 1;
    }
  }
  for (let col = 0; col < size; col += 1) {
    const line = modules.map((row) => row[col]);
    penalty += linearRunPenalty(line) + finderLikePenalty(line);
  }

  // N2: 2x2 blocks of a single colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const color = modules[row][col];
      if (
        modules[row][col + 1] === color &&
        modules[row + 1][col] === color &&
        modules[row + 1][col + 1] === color
      ) {
        penalty += PENALTY_N2;
      }
    }
  }

  // N4: deviation of the dark-module proportion from 50%, in 5% steps.
  const darkPercent = (darkCount * 100) / (size * size);
  penalty += Math.floor(Math.abs(darkPercent - 50) / 5) * PENALTY_N4;
  return penalty;
}

/**
 * Tries all eight data masks (each with its matching format information)
 * and returns the mask number with the lowest penalty score.
 */
function chooseBestMask(modules, isFunction, size, ecLevel) {
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < MASK_PREDICATES.length; mask += 1) {
    applyMask(modules, isFunction, size, mask);
    drawFormatInformation(modules, isFunction, size, ecLevel, mask);
    const penalty = penaltyScore(modules, size);
    applyMask(modules, isFunction, size, mask); // XOR undoes the mask.
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
  }
  return bestMask;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encodes text as a QR code module matrix (ISO/IEC 18004, byte mode).
 *
 * The smallest version (1-40) able to hold the UTF-8 encoding of `text` at
 * the requested error-correction level is selected automatically.
 *
 * @param {string} text Text to encode (encoded as UTF-8).
 * @param {{ ecLevel?: 'L' | 'M' | 'Q' | 'H' }} [options]
 *   `ecLevel` — error-correction level, defaults to 'M'.
 * @returns {{ version: number, size: number, modules: boolean[][] }}
 *   `modules` holds `size` rows of `size` booleans; true means a dark module.
 * @throws {Error} If `ecLevel` is invalid or the text does not fit in
 *   version 40 at the requested level.
 */
export function qrMatrix(text, { ecLevel = 'M' } = {}) {
  if (!Object.prototype.hasOwnProperty.call(EC_LEVEL_BITS, ecLevel)) {
    throw new Error(
      `Invalid ecLevel ${JSON.stringify(ecLevel)}; expected "L", "M", "Q" or "H".`
    );
  }
  const bytes = new TextEncoder().encode(String(text));
  const version = selectVersion(bytes.length, ecLevel);
  const size = version * 4 + 17;

  const dataCodewords = buildDataCodewords(bytes, version, ecLevel);
  const codewords = interleaveWithErrorCorrection(
    dataCodewords,
    version,
    ecLevel
  );

  const modules = createGrid(size, false);
  const isFunction = createGrid(size, false);
  drawFunctionPatterns(modules, isFunction, size, version, ecLevel);
  placeCodewords(modules, isFunction, size, codewords);

  const mask = chooseBestMask(modules, isFunction, size, ecLevel);
  applyMask(modules, isFunction, size, mask);
  drawFormatInformation(modules, isFunction, size, ecLevel, mask);

  return { version, size, modules };
}

/**
 * Encodes text as a self-contained SVG string.
 *
 * The SVG has no width/height attributes (it scales to its container), uses
 * `currentColor` for the dark modules, and includes a quiet zone of `margin`
 * modules on every side.
 *
 * @param {string} text Text to encode (encoded as UTF-8).
 * @param {{ ecLevel?: 'L' | 'M' | 'Q' | 'H', margin?: number }} [options]
 *   `ecLevel` — error-correction level, defaults to 'M'.
 *   `margin` — quiet-zone width in modules, defaults to 4.
 * @returns {string} A complete `<svg>` element string.
 * @throws {Error} Same conditions as qrMatrix().
 */
export function qrSvg(text, { ecLevel = 'M', margin = 4 } = {}) {
  const { size, modules } = qrMatrix(text, { ecLevel });
  const quietZone = Math.max(0, Math.floor(margin));
  const extent = size + 2 * quietZone;

  const segments = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) {
        segments.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" ` +
    `role="img" aria-hidden="true" shape-rendering="crispEdges">` +
    `<path fill="currentColor" d="${segments.join('')}"/>` +
    `</svg>`
  );
}
