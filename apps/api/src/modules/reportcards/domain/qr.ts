/**
 * Encodeur QR Code (ISO/IEC 18004), PUR et déterministe : mode octets, correction d'erreurs niveau M, versions 1 à 10
 * (jusqu'à 213 octets), choix automatique du masque. Écrit ici parce que le module ne peut pas ajouter de dépendance :
 * le QR du bulletin ne porte qu'une URL de vérification (`https://<domaine>/v/<code>`, ~60 octets).
 *
 * Sortie : une matrice de modules et un SVG (un seul `<path>`, aucun script, aucune référence externe) qui s'insère tel quel
 * dans le HTML rendu par Chromium sans réseau. Algorithme : correction de Reed-Solomon sur GF(256) (polynôme 0x11D),
 * entrelacement des blocs, motifs de repérage / alignement / synchronisation, informations de format (BCH 15,5) et de
 * version (BCH 18,6), pénalités N1 à N4. Vérifié contre une implémentation de référence (`test/unit/qr.test.ts`).
 */
export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly mask: number;
  /** `modules[y][x]` : `true` = module sombre. */
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>;
}

export class QrCapacityError extends Error {
  constructor(bytes: number) {
    super(`Texte trop long pour un QR code de version ≤ 10 en niveau M (${bytes} octets, 213 maximum).`);
    this.name = "QrCapacityError";
  }
}

/** Codewords de correction par bloc, niveau M (index = version). */
const ECC_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
/** Nombre de blocs, niveau M (index = version). */
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
const MAX_VERSION = 10;
const FORMAT_BITS_M = 0; // L=1, M=0, Q=3, H=2

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number): number =>
  Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK_M[version]! * BLOCKS_M[version]!;

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// --- GF(256) / Reed-Solomon -------------------------------------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = result[i]! ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

// --- Construction ----------------------------------------------------------

class Builder {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i += 1) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const pos = alignmentPositions(this.version);
    const n = pos.length;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i]!, pos[j]!);
      }
    }
    this.drawFormat(0);
    this.drawVersion();
  }

  private drawFinder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormat(mask: number): void {
    const data = (FORMAT_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i += 1) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i += 1) this.setFunction(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i += 1) this.setFunction(8, this.size - 15 + i, bit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const color = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, color);
      this.setFunction(b, a, color);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7));
            i += 1;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!this.isFunction[y]![x] && invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  penalty(): number {
    let result = 0;
    const n = this.size;
    const m = this.modules;
    const addHistory = (run: number, history: number[]): void => {
      let r = run;
      if (history[0] === 0) r += n;
      history.pop();
      history.unshift(r);
    };
    const countPatterns = (h: number[]): number => {
      const k = h[1]!;
      const core = k > 0 && h[2] === k && h[3] === k * 3 && h[4] === k && h[5] === k;
      return (core && h[0]! >= k * 4 && h[6]! >= k ? 1 : 0) + (core && h[6]! >= k * 4 && h[0]! >= k ? 1 : 0);
    };
    const terminate = (runColor: boolean, runLength: number, history: number[]): number => {
      let len = runLength;
      if (runColor) {
        addHistory(len, history);
        len = 0;
      }
      len += n;
      addHistory(len, history);
      return countPatterns(history);
    };
    for (let y = 0; y < n; y += 1) {
      let runColor = false;
      let runX = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < n; x += 1) {
        if (m[y]![x] === runColor) {
          runX += 1;
          if (runX === 5) result += 3;
          else if (runX > 5) result += 1;
        } else {
          addHistory(runX, history);
          if (!runColor) result += countPatterns(history) * 40;
          runColor = m[y]![x]!;
          runX = 1;
        }
      }
      result += terminate(runColor, runX, history) * 40;
    }
    for (let x = 0; x < n; x += 1) {
      let runColor = false;
      let runY = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < n; y += 1) {
        if (m[y]![x] === runColor) {
          runY += 1;
          if (runY === 5) result += 3;
          else if (runY > 5) result += 1;
        } else {
          addHistory(runY, history);
          if (!runColor) result += countPatterns(history) * 40;
          runColor = m[y]![x]!;
          runY = 1;
        }
      }
      result += terminate(runColor, runY, history) * 40;
    }
    for (let y = 0; y < n - 1; y += 1) {
      for (let x = 0; x < n - 1; x += 1) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) result += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark += 1;
    const total = n * n;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }
}

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCodewords(version);
  const bits: number[] = [];
  const push = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capBits = capacity * 8;
  push(0, Math.min(4, capBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j += 1) v = (v << 1) | bits[i + j]!;
    codewords.push(v);
  }
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

function addEccAndInterleave(data: readonly number[], version: number): number[] {
  const numBlocks = BLOCKS_M[version]!;
  const blockEccLen = ECC_PER_BLOCK_M[version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i += 1) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i += 1) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/** Encode `text` (UTF-8) en QR Code niveau M. `mask` (0 à 7) force le masque (tests de référence) ; sinon choix par pénalité. */
export function encodeQr(text: string, options: { mask?: number } = {}): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  for (; version <= MAX_VERSION; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new QrCapacityError(bytes.length);

  const builder = new Builder(version);
  builder.drawFunctionPatterns();
  builder.drawCodewords(addEccAndInterleave(buildCodewords(bytes, version), version));

  let best = options.mask ?? -1;
  if (best < 0) {
    let minPenalty = Infinity;
    for (let m = 0; m < 8; m += 1) {
      builder.applyMask(m);
      builder.drawFormat(m);
      const p = builder.penalty();
      if (p < minPenalty) {
        best = m;
        minPenalty = p;
      }
      builder.applyMask(m);
    }
  }
  builder.applyMask(best);
  builder.drawFormat(best);
  return { version, size: builder.size, mask: best, modules: builder.modules.map((r) => [...r]) };
}

/**
 * SVG du QR : un seul `<path>` (rectangles horizontaux), zone de silence `margin` modules. Aucune couleur injectée par
 * l'appelant : `#000` sur fond blanc (lisibilité maximale pour un lecteur).
 */
export function qrToSvg(matrix: QrMatrix, options: { margin?: number } = {}): string {
  const margin = options.margin ?? 4;
  const total = matrix.size + margin * 2;
  let d = "";
  for (let y = 0; y < matrix.size; y += 1) {
    let x = 0;
    while (x < matrix.size) {
      if (!matrix.modules[y]![x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < matrix.size && matrix.modules[y]![end]) end += 1;
      d += `M${x + margin} ${y + margin}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code de vérification">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  );
}
