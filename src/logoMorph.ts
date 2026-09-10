import { sampleSvgToParticles } from "./svgSampler";
import { LOGO_CONTENT_WORLD_SIZE } from "./sceneSizing";

export type LogoPoint = {
  nx: number;
  ny: number;
};

export type MatchedHome = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

export type TimelineSpec = {
  holdA: number;
  morph: number;
  holdB: number;
};

export const DEFAULT_TIMELINE: TimelineSpec = {
  holdA: 1.4,
  morph: 4.2,
  holdB: 1.6
};

export function timelineDuration(spec: TimelineSpec) {
  return spec.holdA + spec.morph + spec.holdB;
}

export function easeInOutCubic(t: number) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function timeToMorphBlend(time: number, spec: TimelineSpec) {
  if (time <= spec.holdA) {
    return 0;
  }
  if (time >= spec.holdA + spec.morph) {
    return 1;
  }
  return easeInOutCubic((time - spec.holdA) / Math.max(0.001, spec.morph));
}

export function sampleWalkerHomes(svgText: string, particleCount: number): LogoPoint[] {
  const grid = clamp(Math.round(46 * Math.sqrt(particleCount / 8000)), 40, 104);
  try {
    const denseCount = clamp(particleCount, 6000, 18000);
    const raw = sampleSvgToParticles(svgText, denseCount, 11);
    const seen = new Set<number>();
    const out: LogoPoint[] = [];
    for (let i = 0; i < raw.count; i += 1) {
      const px = raw.positions[i * 3];
      const py = raw.positions[i * 3 + 1];
      const nx = px / LOGO_CONTENT_WORLD_SIZE + 0.5;
      const ny = 0.5 - py / LOGO_CONTENT_WORLD_SIZE;
      const gx = Math.round(nx * grid);
      const gy = Math.round(ny * grid);
      const key = gx * 8192 + gy;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ nx: gx / grid, ny: gy / grid });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function matchLogoHomes(a: LogoPoint[], b: LogoPoint[]): MatchedHome[] {
  const n = Math.max(a.length, b.length, 1);
  const from = padPoints(a, n);
  const to = padPoints(b, n);
  const assigned = nearestAssign(from, to);
  return from.map((point, index) => ({
    ax: point.nx,
    ay: point.ny,
    bx: assigned[index].nx,
    by: assigned[index].ny
  }));
}

export function alignTargetPositions(from: Float32Array, to: Float32Array): Float32Array {
  const fromCount = Math.floor(from.length / 3);
  const toCount = Math.floor(to.length / 3);
  const count = fromCount;
  const out = new Float32Array(count * 3);
  if (count === 0) {
    return out;
  }

  const fromPts: LogoPoint[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    fromPts[i] = { nx: from[i * 3], ny: from[i * 3 + 1] };
  }
  const toPts: LogoPoint[] = [];
  for (let i = 0; i < toCount; i += 1) {
    toPts.push({ nx: to[i * 3], ny: to[i * 3 + 1] });
  }
  const paddedTo = padPoints(toPts, count);
  const matched = nearestAssign(fromPts, paddedTo);
  for (let i = 0; i < count; i += 1) {
    out[i * 3] = matched[i].nx;
    out[i * 3 + 1] = matched[i].ny;
    out[i * 3 + 2] = from[i * 3 + 2] ?? 0;
  }
  return out;
}

function padPoints(points: LogoPoint[], count: number): LogoPoint[] {
  if (count <= 0) {
    return [];
  }
  if (points.length === 0) {
    return Array.from({ length: count }, () => ({ nx: 0.5, ny: 0.5 }));
  }
  if (points.length >= count) {
    return points.slice(0, count);
  }
  const out = points.slice();
  let i = 0;
  while (out.length < count) {
    const src = points[i % points.length];
    const jitter = 0.008;
    out.push({
      nx: src.nx + (hash(i + 13) - 0.5) * jitter,
      ny: src.ny + (hash(i + 29) - 0.5) * jitter
    });
    i += 1;
  }
  return out;
}

function nearestAssign(from: LogoPoint[], to: LogoPoint[]): LogoPoint[] {
  const assigned = new Array<LogoPoint>(from.length);
  const used = new Uint8Array(to.length);
  const cell = 0.08;
  const buckets = new Map<number, number[]>();

  for (let i = 0; i < to.length; i += 1) {
    const key = cellKey(to[i].nx, to[i].ny, cell);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      buckets.set(key, [i]);
    }
  }

  const leftovers: number[] = [];
  for (let i = 0; i < from.length; i += 1) {
    const point = from[i];
    const gx = Math.round(point.nx / cell);
    const gy = Math.round(point.ny / cell);
    let best = -1;
    let bestD = Infinity;
    for (let ox = -2; ox <= 2; ox += 1) {
      for (let oy = -2; oy <= 2; oy += 1) {
        const bucket = buckets.get(packCell(gx + ox, gy + oy));
        if (!bucket) {
          continue;
        }
        for (let k = 0; k < bucket.length; k += 1) {
          const idx = bucket[k];
          if (used[idx]) {
            continue;
          }
          const dx = to[idx].nx - point.nx;
          const dy = to[idx].ny - point.ny;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
    }
    if (best >= 0) {
      used[best] = 1;
      assigned[i] = to[best];
    } else {
      leftovers.push(i);
    }
  }

  let cursor = 0;
  for (let i = 0; i < leftovers.length; i += 1) {
    while (cursor < to.length && used[cursor]) {
      cursor += 1;
    }
    const idx = cursor < to.length ? cursor : i % to.length;
    assigned[leftovers[i]] = to[idx];
    if (cursor < to.length) {
      used[cursor] = 1;
      cursor += 1;
    }
  }

  for (let i = 0; i < assigned.length; i += 1) {
    if (!assigned[i]) {
      assigned[i] = to[i % to.length];
    }
  }
  return assigned;
}

function cellKey(x: number, y: number, cell: number) {
  return packCell(Math.round(x / cell), Math.round(y / cell));
}

function packCell(gx: number, gy: number) {
  return gx * 4099 + gy;
}

function hash(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
