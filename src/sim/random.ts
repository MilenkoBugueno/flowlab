export interface RandomSource {
  next(): number;
}

export function createSeededRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return {
    next() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function deriveSeed(seed: number, stream: number): number {
  let value = (seed >>> 0) ^ stream;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function poisson(rate: number, random: RandomSource): number {
  const threshold = Math.exp(-rate);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random.next();
  } while (product > threshold);
  return count - 1;
}

export function between(min: number, max: number, random: RandomSource): number {
  return min + (max - min) * random.next();
}
