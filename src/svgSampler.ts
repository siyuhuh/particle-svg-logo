import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { LOGO_CONTENT_WORLD_SIZE } from "./sceneSizing";
import type { ParticleBuffers } from "./types";

type RawPoint = {
  x: number;
  y: number;
  edge: boolean;
};

type TriangleSample = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  area: number;
};

type SvgStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  opacity?: number;
};

const TAU = Math.PI * 2;

export function sampleSvgToParticles(
  svgText: string,
  particleCount: number,
  seed = 7
): ParticleBuffers {
  const loader = new SVGLoader();
  const parsed = loader.parse(svgText);
  const triangles: TriangleSample[] = [];
  const edgePoints: RawPoint[] = [];
  const random = mulberry32(seed);

  parsed.paths.forEach((path) => {
    const style = path.userData?.style as SvgStyle | undefined;
    const hasStroke = shouldUsePaint(style?.stroke, style?.strokeOpacity, style?.opacity);
    const hasFill =
      style?.fill === undefined
        ? !hasStroke
        : shouldUsePaint(style.fill, style.fillOpacity, style.opacity);

    if (hasFill) {
      SVGLoader.createShapes(path).forEach((shape) => {
        collectShapeTriangles(shape, triangles);
        collectShapeEdges(shape, edgePoints);
      });
    }

    if (hasStroke) {
      path.subPaths.forEach((subPath) => {
        const length = Math.max(1, subPath.getLength());
        const divisions = clamp(Math.ceil(length / 2.6), 18, 1100);
        subPath.getSpacedPoints(divisions).forEach((point) => {
          edgePoints.push({ x: point.x, y: point.y, edge: true });
        });
        sampleAutoCloseSegment(subPath, edgePoints);
      });
    }
  });

  const fillBudget = Math.max(0, Math.floor(particleCount * 0.65));
  const sampledPoints = [
    ...edgePoints,
    ...sampleTriangles(triangles, fillBudget, random)
  ];

  if (sampledPoints.length === 0) {
    throw new Error("No visible fill or stroke paths were found in this SVG.");
  }

  shuffle(sampledPoints, random);

  const normalized = normalizePoints(sampledPoints);
  const count = clamp(Math.floor(particleCount), 800, 32000);
  const positions = new Float32Array(count * 3);
  const origins = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const delays = new Float32Array(count);
  const intensities = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const target = normalized[index % normalized.length];
    const repeatJitter = index >= normalized.length ? 0.014 : 0.006;
    const px = target.x + (random() - 0.5) * repeatJitter;
    const py = target.y + (random() - 0.5) * repeatJitter;
    const pz = (random() - 0.5) * (target.edge ? 0.08 : 0.18);
    const originAngle = random() * TAU;
    const originRadius = 2.8 + random() * 3.4;
    const originZ = (random() - 0.5) * 3.4;
    const distanceFromCenter = Math.hypot(px, py);

    positions[index * 3] = px;
    positions[index * 3 + 1] = py;
    positions[index * 3 + 2] = pz;

    origins[index * 3] = Math.cos(originAngle) * originRadius;
    origins[index * 3 + 1] = Math.sin(originAngle) * originRadius;
    origins[index * 3 + 2] = originZ;

    seeds[index] = random() * 1000;
    sizes[index] = target.edge ? 0.9 + random() * 1.45 : 0.65 + random() * 1.1;
    delays[index] = random() * 0.34 + distanceFromCenter * 0.065;
    intensities[index] = target.edge ? 0.9 + random() * 0.8 : 0.48 + random() * 0.7;
  }

  return {
    count,
    positions,
    origins,
    seeds,
    sizes,
    delays,
    intensities
  };
}

export function getRecommendedParticleCount(svgText: string, baseCount: number) {
  const loader = new SVGLoader();
  const parsed = loader.parse(svgText);
  const metrics = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    fillArea: 0,
    totalLength: 0,
    visibleParts: 0
  };

  parsed.paths.forEach((path) => {
    const style = path.userData?.style as SvgStyle | undefined;
    const hasStroke = shouldUsePaint(style?.stroke, style?.strokeOpacity, style?.opacity);
    const hasFill =
      style?.fill === undefined
        ? !hasStroke
        : shouldUsePaint(style.fill, style.fillOpacity, style.opacity);

    if (hasFill) {
      SVGLoader.createShapes(path).forEach((shape) => {
        metrics.visibleParts += 1;
        const geometry = new THREE.ShapeGeometry(shape, 14);
        const position = geometry.getAttribute("position");
        const index = geometry.getIndex();
        const length = index ? index.count : position.count;

        for (let i = 0; i < position.count; i += 1) {
          includeMetricsPoint(metrics, position.getX(i), position.getY(i));
        }

        for (let i = 0; i < length; i += 3) {
          const a = index ? index.getX(i) : i;
          const b = index ? index.getX(i + 1) : i + 1;
          const c = index ? index.getX(i + 2) : i + 2;
          metrics.fillArea +=
            Math.abs(
              (position.getX(b) - position.getX(a)) *
                (position.getY(c) - position.getY(a)) -
                (position.getX(c) - position.getX(a)) *
                  (position.getY(b) - position.getY(a))
            ) * 0.5;
        }

        geometry.dispose();
      });
    }

    if (hasStroke) {
      path.subPaths.forEach((subPath) => {
        const length = Math.max(1, subPath.getLength());
        const points = subPath.getSpacedPoints(clamp(Math.ceil(length / 18), 4, 160));
        metrics.totalLength += length;
        metrics.visibleParts += 1;
        points.forEach((point) => includeMetricsPoint(metrics, point.x, point.y));
      });
    }
  });

  if (!Number.isFinite(metrics.minX) || metrics.visibleParts === 0) {
    return clamp(roundToStep(baseCount, 1000), 2000, 30000);
  }

  const width = Math.max(1, metrics.maxX - metrics.minX);
  const height = Math.max(1, metrics.maxY - metrics.minY);
  const visibleArea = Math.max(1, width * height);
  const maxDimension = Math.max(width, height);
  const sizeScale = clamp(Math.sqrt(visibleArea) / 260, 0.72, 1.35);
  const coverage = clamp(metrics.fillArea / visibleArea, 0, 1);
  const lengthComplexity = metrics.totalLength / maxDimension;
  const partComplexity = Math.sqrt(metrics.visibleParts) * 0.035;
  const detailScale = clamp(
    0.78 + Math.log2(1 + lengthComplexity) * 0.22 + coverage * 0.22 + partComplexity,
    0.78,
    1.55
  );
  const scale = sizeScale * 0.55 + detailScale * 0.45;

  return clamp(roundToStep(baseCount * scale, 1000), 2000, 30000);
}

function includeMetricsPoint(
  metrics: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  },
  x: number,
  y: number
) {
  metrics.minX = Math.min(metrics.minX, x);
  metrics.maxX = Math.max(metrics.maxX, x);
  metrics.minY = Math.min(metrics.minY, y);
  metrics.maxY = Math.max(metrics.maxY, y);
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function shouldUsePaint(paint?: string, paintOpacity = 1, opacity = 1) {
  if (opacity <= 0 || paintOpacity <= 0) {
    return false;
  }

  if (!paint) {
    return true;
  }

  const normalized = paint.trim().toLowerCase();
  return normalized !== "none" && normalized !== "transparent";
}

function collectShapeTriangles(shape: THREE.Shape, triangles: TriangleSample[]) {
  const geometry = new THREE.ShapeGeometry(shape, 18);
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const length = index ? index.count : position.count;

  for (let i = 0; i < length; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    const ax = position.getX(a);
    const ay = position.getY(a);
    const bx = position.getX(b);
    const by = position.getY(b);
    const cx = position.getX(c);
    const cy = position.getY(c);
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) * 0.5;

    if (area > 0.001) {
      triangles.push({ ax, ay, bx, by, cx, cy, area });
    }
  }

  geometry.dispose();
}

// A `Z` close command marks the subpath `autoClose` but DOESN'T add a curve for
// the closing segment, so getSpacedPoints() skips it and the shape looks "open"
// (e.g. the missing left edge of a drawn rectangle). Sample that segment by hand.
function sampleAutoCloseSegment(subPath: THREE.Path, edgePoints: RawPoint[]) {
  const curves = subPath.curves;
  if (!subPath.autoClose || curves.length === 0) {
    return;
  }

  const start = curves[0].getPoint(0);
  const end = curves[curves.length - 1].getPoint(1);
  const segLength = start.distanceTo(end);
  if (segLength <= 1e-4) {
    return;
  }

  const divisions = clamp(Math.ceil(segLength / 2.6), 2, 800);
  for (let i = 1; i <= divisions; i += 1) {
    const t = i / divisions;
    edgePoints.push({
      x: end.x + (start.x - end.x) * t,
      y: end.y + (start.y - end.y) * t,
      edge: true
    });
  }
}

function collectShapeEdges(shape: THREE.Shape, edgePoints: RawPoint[]) {
  const extracted = shape.extractPoints(32);
  const allContours = [extracted.shape, ...extracted.holes];

  allContours.forEach((contour) => {
    contour.forEach((point) => {
      edgePoints.push({ x: point.x, y: point.y, edge: true });
    });
  });
}

function sampleTriangles(
  triangles: TriangleSample[],
  count: number,
  random: () => number
): RawPoint[] {
  if (triangles.length === 0 || count <= 0) {
    return [];
  }

  const samples: RawPoint[] = [];
  const totalArea = triangles.reduce((sum, triangle) => sum + triangle.area, 0);

  for (let i = 0; i < count; i += 1) {
    let cursor = random() * totalArea;
    let triangle = triangles[triangles.length - 1];

    for (const candidate of triangles) {
      cursor -= candidate.area;
      if (cursor <= 0) {
        triangle = candidate;
        break;
      }
    }

    const r1 = Math.sqrt(random());
    const r2 = random();
    const x =
      (1 - r1) * triangle.ax + r1 * (1 - r2) * triangle.bx + r1 * r2 * triangle.cx;
    const y =
      (1 - r1) * triangle.ay + r1 * (1 - r2) * triangle.by + r1 * r2 * triangle.cy;

    samples.push({ x, y, edge: false });
  }

  return samples;
}

function normalizePoints(points: RawPoint[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  const scale = LOGO_CONTENT_WORLD_SIZE / Math.max(width, height);

  return points.map((point) => ({
    x: (point.x - centerX) * scale,
    y: -(point.y - centerY) * scale,
    edge: point.edge
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shuffle<T>(items: T[], random: () => number) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
