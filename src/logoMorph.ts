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

export type TimelineClipTiming = {
  hold: number;
  morph: number;
};

export type TimelineSegment = {
  kind: "hold" | "morph";
  from: number;
  to: number;
  start: number;
  duration: number;
};

export const DEFAULT_CLIP_HOLD = 2.6;
export const DEFAULT_CLIP_MORPH = 3.2;
export const MIN_CLIP_HOLD = 0.4;
export const MAX_CLIP_HOLD = 12;
export const MIN_CLIP_MORPH = 0.4;
export const MAX_CLIP_MORPH = 12;
export const MAX_TIMELINE_CLIPS = 8;

export const DEFAULT_TIMELINE: TimelineSpec = {
  holdA: DEFAULT_CLIP_HOLD,
  morph: DEFAULT_CLIP_MORPH,
  holdB: 1.6
};

export function timelineDuration(spec: TimelineSpec) {
  return spec.holdA + spec.morph + spec.holdB;
}

export function clipLetter(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

export function buildTimelineSegments(
  clips: TimelineClipTiming[],
  loop: boolean
): { segments: TimelineSegment[]; duration: number } {
  const segments: TimelineSegment[] = [];
  let time = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    segments.push({
      kind: "hold",
      from: index,
      to: index,
      start: time,
      duration: Math.max(MIN_CLIP_HOLD, clip.hold)
    });
    time += Math.max(MIN_CLIP_HOLD, clip.hold);
    const hasNext = index + 1 < clips.length;
    const morph = Math.max(MIN_CLIP_MORPH, clip.morph);
    if (morph > 0 && (hasNext || (loop && clips.length > 1))) {
      segments.push({
        kind: "morph",
        from: index,
        to: hasNext ? index + 1 : 0,
        start: time,
        duration: morph
      });
      time += morph;
    }
  }
  return { segments, duration: Math.max(0.2, time) };
}

export function sampleTimeline(
  time: number,
  clips: TimelineClipTiming[],
  loop: boolean
) {
  const { segments, duration } = buildTimelineSegments(clips, loop);
  if (clips.length === 0) {
    return { fromIndex: 0, toIndex: 0, clipIndex: 0, blend: 0, duration: 0 };
  }
  let t = time;
  if (loop && duration > 0) {
    t = ((t % duration) + duration) % duration;
  } else {
    t = Math.min(duration, Math.max(0, t));
  }
  const last = segments[segments.length - 1];
  const segment =
    segments.find((item) => t < item.start + item.duration - 0.0001) ?? last;
  if (!segment) {
    return { fromIndex: 0, toIndex: 0, clipIndex: 0, blend: 0, duration };
  }
  const local = segment.duration <= 0 ? 1 : (t - segment.start) / segment.duration;
  const eased = easeInOutCubic(clamp01(local));
  const clipIndex = segment.from;

  // Two logos ping-pong on one A/B pairing so the formed shape never rematches
  // on hold, and the return trip eases blend 1 → 0 instead of rebuilding homes.
  if (clips.length === 2) {
    if (segment.kind === "hold") {
      return {
        fromIndex: 0,
        toIndex: 1,
        clipIndex,
        blend: segment.from === 0 ? 0 : 1,
        duration
      };
    }
    if (segment.from === 1 && segment.to === 0) {
      return {
        fromIndex: 0,
        toIndex: 1,
        clipIndex,
        blend: easeInOutCubic(1 - clamp01(local)),
        duration
      };
    }
    return { fromIndex: 0, toIndex: 1, clipIndex, blend: eased, duration };
  }

  if (segment.kind === "hold") {
    const incoming = segments.find((item) => item.kind === "morph" && item.to === segment.from);
    const outgoing = segments.find((item) => item.kind === "morph" && item.from === segment.from);
    const atCycleStart = segment.start === 0;
    if (incoming && !atCycleStart) {
      return {
        fromIndex: incoming.from,
        toIndex: incoming.to,
        clipIndex,
        blend: 1,
        duration
      };
    }
    if (outgoing) {
      return {
        fromIndex: outgoing.from,
        toIndex: outgoing.to,
        clipIndex,
        blend: 0,
        duration
      };
    }
    return { fromIndex: segment.from, toIndex: segment.from, clipIndex, blend: 0, duration };
  }

  return {
    fromIndex: segment.from,
    toIndex: segment.to,
    clipIndex,
    blend: eased,
    duration
  };
}

export function clipHoldStart(clips: TimelineClipTiming[], index: number, loop: boolean) {
  const { segments } = buildTimelineSegments(clips, loop);
  return segments.find((segment) => segment.kind === "hold" && segment.from === index)?.start ?? 0;
}

export function matchPointPairs(
  a: Array<{ x: number; y: number }>,
  b: Array<{ x: number; y: number }>
): MatchedHome[] {
  return matchLogoHomes(
    a.map((point) => ({ nx: point.x, ny: point.y })),
    b.map((point) => ({ nx: point.x, ny: point.y }))
  );
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

export function chainMatchPointSets(sets: LogoPoint[][]): LogoPoint[][] {
  if (sets.length === 0) {
    return [];
  }
  const n = Math.max(1, ...sets.map((set) => set.length));
  const padded = sets.map((set) => padPoints(set, n));
  const homes: LogoPoint[][] = [padded[0]];
  for (let i = 1; i < padded.length; i += 1) {
    homes.push(nearestAssign(homes[i - 1], padded[i]));
  }
  return homes;
}

export function chainMatchPositions(sets: Float32Array[]): Float32Array[] {
  if (sets.length === 0) {
    return [];
  }
  const homes: Float32Array[] = [sets[0]];
  for (let i = 1; i < sets.length; i += 1) {
    homes.push(alignTargetPositions(homes[i - 1], sets[i]));
  }
  return homes;
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
