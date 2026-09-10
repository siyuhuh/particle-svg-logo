import { useEffect, useMemo, useRef } from "react";
import { matchLogoHomes, sampleWalkerHomes } from "./logoMorph";
import { useHandTracking, type TrackedHand } from "./useHandTracking";
import type { ParticleSettings } from "./types";

type WebcamWalkersOverlayProps = {
  svgText: string;
  svgTextB?: string;
  morphBlend?: number;
  captureClean?: boolean;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
};

type Walker = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
  nx: number;
  ny: number;
  phase: number;
  face: number;
  /** Per-walker pace multiplier — desyncs the crowd so it never moves as a sheet. */
  sMul: number;
  /** Per-walker seed for organic wander + push-direction jitter. */
  wSeed: number;
  /** False until placed in correct canvas space by resize() (real layout bounds). */
  placed: boolean;
  /** 0 = home, 1 = fully displaced (shoved aside, piling, no home pull yet). */
  disp: number;
  /** Sprite row: 0 = male, 1 = female. */
  gender: number;
  /** 0 = calm (Core color) → 1 = agitated (Hot color); smoothed for color blending. */
  heat: number;
  /** >0 while tumbling after being dropped from a pinch (counts down to 0). */
  fall: number;
  /** True this frame while dangling from a pinch — drawn last, with a sway. */
  held: boolean;
  /** >0 while stopped for a chance chat with a passing neighbour. */
  chat: number;
  /** Which way to face while chatting (toward the partner). */
  chatDir: number;
  /** Logo A home in normalized logo space. */
  ax: number;
  ay: number;
  /** Logo B home in normalized logo space. */
  bx: number;
  by: number;
};

// Walk-cycle sprite sheet. Rows = PALETTE_STEPS heat steps × GENDERS (male, female).
const WALK_FRAMES = 12;
const SPRITE_CELL = 96;
const GENDERS = 2;
// Heat ramp resolution: each walker picks a step from calm (Core) → hot (Hot).
const PALETTE_STEPS = 6;

function parseHex(hex: string): [number, number, number] {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) {
    return [248, 252, 255];
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function buildWalkerSheet(coreHex: string, fieldHex: string, hotHex: string) {
  const sheet = document.createElement("canvas");
  sheet.width = SPRITE_CELL * WALK_FRAMES;
  sheet.height = SPRITE_CELL * GENDERS * PALETTE_STEPS;
  const c = sheet.getContext("2d");
  if (!c) {
    return sheet;
  }
  c.lineCap = "round";
  c.lineJoin = "round";

  const cell = SPRITE_CELL;
  const cx = cell / 2;
  const headR = cell * 0.115;
  const shoulderY = cell * 0.37;
  const hipY = cell * 0.58;
  const legLen = cell * 0.3;
  const armLen = cell * 0.22;
  const stroke = cell * 0.12;
  const dark = "rgba(2, 6, 12, 0.92)";
  const core = parseHex(coreHex);
  const field = parseHex(fieldHex);
  const hot = parseHex(hotHex);

  for (let step = 0; step < PALETTE_STEPS; step += 1) {
    // 0 → Core, 0.5 → Field, 1 → Hot (a 3-stop thermal ramp).
    const s = step / (PALETTE_STEPS - 1);
    const rgb = s < 0.5 ? mixColor(core, field, s * 2) : mixColor(field, hot, (s - 0.5) * 2);
    const light = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.98)`;

    for (let g = 0; g < GENDERS; g += 1) {
      const female = g === 1;
      const rowY = (step * GENDERS + g) * cell;
      // Female: shorter legs peeking below a dress hem; male: full legs + torso line.
      const legTop = female ? hipY + cell * 0.05 : hipY;
      const legLength = female ? legLen * 0.6 : legLen;

      for (let f = 0; f < WALK_FRAMES; f += 1) {
        const t = (f / WALK_FRAMES) * Math.PI * 2;
        const legA = Math.sin(t) * 0.5;
        const armA = -Math.sin(t) * 0.42;
        const bob = -Math.abs(Math.cos(t)) * cell * 0.025;
        const ox = f * cell;
        const sY = rowY + shoulderY + bob;
        const hY = rowY + hipY + bob;
        const ltY = rowY + legTop + bob;

        // Body (limbs + torso/dress): dark thick pass then light thin pass → outlined.
        const drawBody = (color: string, width: number) => {
          c.strokeStyle = color;
          c.fillStyle = color;
          c.lineWidth = width;
          c.beginPath();
          c.moveTo(ox + cx, ltY);
          c.lineTo(ox + cx + Math.sin(legA) * legLength, ltY + Math.cos(legA) * legLength);
          c.moveTo(ox + cx, ltY);
          c.lineTo(ox + cx - Math.sin(legA) * legLength, ltY + Math.cos(legA) * legLength);
          c.stroke();
          c.beginPath();
          c.moveTo(ox + cx, sY);
          c.lineTo(ox + cx + Math.sin(armA) * armLen, sY + Math.cos(armA) * armLen);
          c.moveTo(ox + cx, sY);
          c.lineTo(ox + cx - Math.sin(armA) * armLen, sY + Math.cos(armA) * armLen);
          c.stroke();
          if (female) {
            // dress: a triangle from the shoulders to a wide hem (filled + stroked → rim).
            const hemY = rowY + hipY + cell * 0.05 + bob;
            const hemW = cell * 0.16;
            c.beginPath();
            c.moveTo(ox + cx, sY - cell * 0.01);
            c.lineTo(ox + cx + hemW, hemY);
            c.lineTo(ox + cx - hemW, hemY);
            c.closePath();
            c.fill();
            c.stroke();
          } else {
            c.beginPath();
            c.moveTo(ox + cx, sY);
            c.lineTo(ox + cx, hY);
            c.stroke();
          }
        };

        // Thick dark halo then thin colored core → each figure keeps a bold outline so
        // it stays distinct when overlapping a neighbour (no merging into one blob).
        drawBody(dark, stroke + cell * 0.16);
        drawBody(light, stroke);

        // Head: a bold dark ring then the colored fill → every head is clearly bordered,
        // so overlapping heads read as separate people instead of one smear.
        const headY = rowY + shoulderY - headR * 1.6 + bob;
        c.beginPath();
        c.fillStyle = dark;
        c.arc(ox + cx, headY, headR + cell * 0.07, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.fillStyle = light;
        c.arc(ox + cx, headY, headR, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  return sheet;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Cheap deterministic hash in [0,1) from a seed.
function hash(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// Cheap smooth pseudo-noise in ~[-1,1]; layered sines keyed by a per-walker seed.
function snoise(t: number, seed: number) {
  return (
    Math.sin(t + seed) * 0.5 +
    Math.sin(t * 0.53 + seed * 1.7) * 0.32 +
    Math.sin(t * 1.97 + seed * 0.31) * 0.18
  );
}

export function WebcamWalkersOverlay({
  svgText,
  svgTextB,
  morphBlend = 0,
  captureClean = false,
  settings,
  replayNonce,
  paused
}: WebcamWalkersOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Shared webcam + MediaPipe layer: tracked hands (≤2) with velocity + gesture.
  const { handsRef, status, modelReady, videoRef } = useHandTracking({
    enabled: true,
    viewRef: containerRef
  });

  const walkerSheet = useMemo(
    () =>
      buildWalkerSheet(
        settings.particleColor,
        settings.particleAccentColor,
        settings.particleHighlightColor
      ),
    [settings.particleColor, settings.particleAccentColor, settings.particleHighlightColor]
  );

  // Sample both logos onto an EVEN GRID so the crowd covers each shape uniformly,
  // then pair homes so people take short walks from A to B.
  const homes = useMemo(() => {
    const pointsA = sampleWalkerHomes(svgText, settings.particleCount);
    const pointsB = svgTextB && svgTextB !== svgText
      ? sampleWalkerHomes(svgTextB, settings.particleCount)
      : pointsA;
    return matchLogoHomes(pointsA, pointsB.length > 0 ? pointsB : pointsA);
  }, [svgText, svgTextB, settings.particleCount]);

  // Latest props available to the rAF loop without restarting it.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const morphBlendRef = useRef(morphBlend);
  morphBlendRef.current = morphBlend;
  const captureCleanRef = useRef(captureClean);
  captureCleanRef.current = captureClean;
  const walkersRef = useRef<Walker[]>([]);

  // Rebuild walkers whenever the logo pair / count changes.
  useEffect(() => {
    const view = containerRef.current?.getBoundingClientRect();
    const w = view?.width ?? window.innerWidth;
    const h = view?.height ?? window.innerHeight;
    const fit = Math.min(w, h) * 0.78;
    const ox = w / 2 - fit / 2;
    const oy = h / 2 - fit / 2;

    const prev = walkersRef.current;
    const next: Walker[] = homes.map((home, i) => {
      const hx = ox + home.ax * fit;
      const hy = oy + home.ay * fit;
      const old = prev[i];
      // Fresh walkers are placed near home by resize() (which has the real canvas
      // bounds); the build effect can run while the overlay is unmounted, so its
      // bounds may be a wrong window fallback — don't trust them for spawn here.
      return {
        x: old ? old.x : hx,
        y: old ? old.y : hy,
        vx: old ? old.vx : 0,
        vy: old ? old.vy : 0,
        hx,
        hy,
        nx: home.ax,
        ny: home.ay,
        ax: home.ax,
        ay: home.ay,
        bx: home.bx,
        by: home.by,
        phase: old ? old.phase : Math.random() * Math.PI * 2,
        face: old ? old.face : Math.random() < 0.5 ? -1 : 1,
        sMul: old ? old.sMul : 0.74 + Math.random() * 0.52,
        wSeed: old ? old.wSeed : Math.random() * 1000,
        placed: old ? old.placed : false,
        disp: old ? old.disp : 0,
        gender: old ? old.gender : Math.random() < 0.5 ? 0 : 1,
        heat: old ? old.heat : 0,
        fall: old ? old.fall : 0,
        held: false,
        chat: 0,
        chatDir: old ? old.chatDir : 1
      };
    });
    walkersRef.current = next;
  }, [homes]);

  // Scatter the crowd on replay so they walk back into formation.
  useEffect(() => {
    const view = containerRef.current?.getBoundingClientRect();
    const w = view?.width ?? window.innerWidth;
    const h = view?.height ?? window.innerHeight;
    walkersRef.current.forEach((walker) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.min(w, h) * (0.4 + Math.random() * 0.4);
      walker.x = w / 2 + Math.cos(angle) * radius;
      walker.y = h / 2 + Math.sin(angle) * radius;
      walker.vx = 0;
      walker.vy = 0;
    });
  }, [replayNonce]);

  // Animation loop — runs once; reads latest settings via refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !container || !ctx) {
      return;
    }

    let raf = 0;
    let last = performance.now();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0;
    let cssH = 0;
    // Grace (60fps-frame units) so a 1-frame detection dropout doesn't make the crowd
    // bolt home; stays >0 while a hand is in frame, decays once the hand leaves.
    let handHold = 0;
    // Painter's-order index buffer (sorted back→front by y each frame) so people lower
    // on screen (nearer) correctly occlude those behind. Reused to avoid GC churn.
    let drawOrder: number[] = [];
    // Per-frame gesture bookkeeping, hoisted to avoid GC churn.
    const grabbedBy = new Map<number, TrackedHand>();
    const followTargets = new Map<number, { x: number; y: number }>();
    const followingSet = new Set<number>();

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      cssW = Math.max(1, bounds.width);
      cssH = Math.max(1, bounds.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    // Element-size changes (panel toggles, first layout) don't fire window 'resize';
    // observe the container so cssW/cssH become valid as soon as it's laid out.
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(container);

    const mirror = true;

    const drawCover = (source: HTMLVideoElement) => {
      const sw = source.videoWidth;
      const sh = source.videoHeight;
      if (!sw || !sh) {
        return;
      }
      const scale = Math.max(cssW / sw, cssH / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.save();
      if (mirror) {
        ctx.translate(cssW, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(source, (cssW - dw) / 2, (cssH - dh) / 2, dw, dh);
      ctx.restore();
    };

    const twoPi = Math.PI * 2;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const deltaMs = now - last;
      last = now;
      const dt = clamp(deltaMs / 16.667, 0.2, 2.2);

      const cfg = settingsRef.current;
      const walkers = walkersRef.current;
      const hands = handsRef.current;
      const video = videoRef.current;

      // --- Tuning from panel sliders (velocities are px / 60fps-frame) ---
      // Only the HAND pushes, and only within this radius of it — localized, so the
      // rest of the crowd holds formation (no whole-frame scatter). REPEL = reach.
      const handRadius = (0.14 + clamp(cfg.repelRadius, 0, 1) * 0.24) * Math.min(cssW, cssH);
      const pushJitter = 0.1 + cfg.flicker * 0.7;
      // FLEE: people the hand sweeps over turn and WALK away (piling AHEAD of the hand),
      // accelerating to a capped pace. mouseForce = how briskly; never a dust-fling.
      const fleeSpeed = (2.3 + clamp(cfg.mouseForce, 0, 3) * 1.4) * cssW * 0.0016;
      const fleeAccel = clamp(0.14 + cfg.mouseForce * 0.05, 0.1, 0.28);
      // Hand speed (px/frame) at which the push is "full". A still hand barely nudges,
      // so it can never trap the crowd out of formation forever.
      const handFullSpeed = Math.max(2.4, cssW * 0.004);
      // Panic: while a MOVING hand is on them they scurry faster + a bit chaotically.
      // panicGain = extra pace, panicNoise = time-varying heading wobble (radians). The
      // leg cadence follows the travel speed automatically (foot-locked), so fast = hurried.
      const panicGain = 0.25 + clamp(cfg.mouseForce, 0, 3) * 0.3;
      const panicNoise = 0.32 + clamp(cfg.turbulence, 0, 1) * 0.95;
      // Return is an adjustable stroll: walkerReturnSpeed 0 → a slow amble, 1 → brisk.
      // Far walkers cap at this pace; near ones ease in (so they arrive, not overshoot).
      const returnSpeed = (0.6 + clamp(cfg.walkerReturnSpeed, 0, 1) * 3.4) * cssW * 0.0016;
      const returnStiffness = 0.06 + clamp(cfg.walkerReturnSpeed, 0, 1) * 0.05;
      // Low accel = they pick up walking pace gradually instead of snapping to speed.
      const returnAccel = 0.1 + clamp(cfg.walkerReturnSpeed, 0, 1) * 0.1;
      // How much they curve / meander on the way home instead of beelining (0 = straight).
      const wanderAmt = clamp(cfg.walkerWander, 0, 1);
      const homeDamping = Math.pow(0.86, dt);
      // Shoved aside then left alone → a step or two and stop, standing as a pile.
      const pileDamping = Math.pow(0.82, dt);
      const maxSpeed = Math.max(fleeSpeed * (1 + panicGain), returnSpeed) * 1.3;
      const idleRate = 0.05 * Math.max(0.15, cfg.animationSpeed);
      // Once the hand LEAVES the frame, displacement fades → they commit to walking
      // home; while a hand is still on screen, piles persist (worked area stays clean).
      const releaseFade = clamp(0.085 * Math.max(0.3, cfg.animationSpeed * 2), 0.04, 0.2);
      // Bounded sway around home → the standing crowd shuffles without drifting away.
      const spacing =
        (Math.min(cssW, cssH) * 0.78) /
        Math.max(8, Math.round(Math.sqrt(Math.max(1, walkers.length)) * 1.4));
      const swayAmp = spacing * (0.12 + cfg.turbulence * 0.5);
      // On-screen figure size (mirrors the render size below) and the ground distance a
      // full 2-step gait should cover — used to FOOT-LOCK the legs so a stride matches the
      // distance travelled (no sliding). Walk cadence shortens the stride → more steps.
      const figureBase = clamp(spacing * 1.7, 8, 46);
      const figureSize = figureBase * clamp(cfg.pointSize / 1.6, 0.55, 2.6);
      const strideCycle = Math.max(
        6,
        figureSize * 0.6 * (0.4 / clamp(cfg.animationSpeed, 0.2, 1.2))
      );
      const t = now * 0.001;

      // Any hand in frame keeps the gate open (piles hold); empty frame → fade home.
      let anyHand = false;
      for (let i = 0; i < hands.length; i += 1) {
        if (hands[i].active > 0.5) {
          anyHand = true;
          break;
        }
      }
      if (anyHand) {
        handHold = 12;
      } else {
        handHold = Math.max(0, handHold - dt);
      }
      const handActive = handHold > 0;

      // Map normalized homes into the current (valid) canvas space every frame, so
      // layout/resize is always reflected and fresh walkers land exactly on the logo.
      const fit = Math.min(cssW, cssH) * 0.78;
      const ox = cssW / 2 - fit / 2;
      const oy = cssH / 2 - fit / 2;

      // --- Gesture bookkeeping (per hand): pinch grabs, point trails + recruits ---
      grabbedBy.clear();
      followTargets.clear();
      followingSet.clear();
      if (!pausedRef.current) {
        for (let hi = 0; hi < hands.length; hi += 1) {
          const h = hands[hi];
          if (h.grabbedIndex >= walkers.length) {
            h.grabbedIndex = -1; // logo/shape changed under us
          }
          const pinching = h.gesture === "pinch" && h.active > 0.5;
          if (pinching) {
            if (h.grabbedIndex < 0) {
              // Grab the walker nearest the pinch point (one per hand).
              const grabR = handRadius * 0.55;
              let best = -1;
              let bestD = grabR * grabR;
              for (let i = 0; i < walkers.length; i += 1) {
                if (grabbedBy.has(i)) continue;
                const dx = walkers[i].x - h.pinchX;
                const dy = walkers[i].y - h.pinchY;
                const dd = dx * dx + dy * dy;
                if (dd < bestD) {
                  bestD = dd;
                  best = i;
                }
              }
              h.grabbedIndex = best;
            }
          } else if (h.grabbedIndex >= 0) {
            // Released: the walker keeps the hand's motion as a throw + a downward
            // toss, tumbles briefly, then lies in a heap until hands leave frame.
            const wk = walkers[h.grabbedIndex];
            wk.vx = h.vx * 0.6;
            wk.vy = Math.max(1.6, h.vy * 0.6 + 1.8);
            wk.fall = 1;
            wk.disp = 1;
            wk.chat = 0;
            h.grabbedIndex = -1;
          }
          if (h.grabbedIndex >= 0) {
            grabbedBy.set(h.grabbedIndex, h);
          }

          if (h.gesture === "point" && h.active > 0.5) {
            // Breadcrumb trail: only append once the fingertip has moved a step.
            const trail = h.trail;
            const lastPt = trail.length ? trail[trail.length - 1] : null;
            const minStep = Math.max(6, spacing * 0.55);
            if (
              !lastPt ||
              (h.tipX - lastPt.x) ** 2 + (h.tipY - lastPt.y) ** 2 > minStep * minStep
            ) {
              trail.push({ x: h.tipX, y: h.tipY });
              if (trail.length > 44) {
                trail.shift();
              }
            }
            // Prune followers invalidated by a shape rebuild, then mark live ones.
            let w = 0;
            for (let k = 0; k < h.followers.length; k += 1) {
              if (h.followers[k] < walkers.length) {
                h.followers[w] = h.followers[k];
                w += 1;
              }
            }
            h.followers.length = w;
            for (let k = 0; k < h.followers.length; k += 1) {
              followingSet.add(h.followers[k]);
            }
            // Recruit one walker per frame — the line grows person by person.
            if (h.followers.length < 22) {
              let best = -1;
              let bestD = handRadius * handRadius;
              for (let i = 0; i < walkers.length; i += 1) {
                if (followingSet.has(i) || grabbedBy.has(i)) continue;
                const dx = walkers[i].x - h.tipX;
                const dy = walkers[i].y - h.tipY;
                const dd = dx * dx + dy * dy;
                if (dd < bestD) {
                  bestD = dd;
                  best = i;
                }
              }
              if (best >= 0) {
                h.followers.push(best);
                followingSet.add(best);
              }
            }
            // Follower k chases the breadcrumb (k+1) gaps behind the fingertip.
            const gap = 3;
            for (let k = 0; k < h.followers.length; k += 1) {
              const ti = Math.max(0, trail.length - 1 - (k + 1) * gap);
              if (trail.length) {
                followTargets.set(h.followers[k], trail[ti]);
              }
            }
          } else if (h.followers.length || h.trail.length) {
            // Gesture ended → the line dissolves and everyone strolls home.
            h.followers.length = 0;
            h.trail.length = 0;
          }
        }
      }

      // Chance encounters: two strollers passing close sometimes stop face to
      // face for a moment, then walk on. Only while no hand is working the crowd
      // and only for walkers actually in motion — the standing formation stays
      // still. Sampled (not O(n²)): a few random probes against nearby indices,
      // which the grid sampling keeps roughly spatially coherent.
      if (!pausedRef.current && !handActive) {
        const maxD2 = (spacing * 1.15) ** 2;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const i = (Math.random() * walkers.length) | 0;
          const a = walkers[i];
          if (!a || a.chat > 0 || a.disp > 0.5 || a.fall > 0) continue;
          if (Math.hypot(a.vx, a.vy) < 0.25) continue;
          const jEnd = Math.min(walkers.length, i + 34);
          for (let j = i + 1; j < jEnd; j += 1) {
            const b = walkers[j];
            if (b.chat > 0 || b.disp > 0.5 || b.fall > 0) continue;
            const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
            if (dd > maxD2) continue;
            if (Math.random() < 0.18) {
              const dur = 110 + Math.random() * 120;
              a.chat = dur;
              b.chat = dur * (0.85 + Math.random() * 0.3);
              a.chatDir = b.x >= a.x ? 1 : -1;
              b.chatDir = -a.chatDir;
            }
            break;
          }
        }
      }

      if (!pausedRef.current) {
        for (let i = 0; i < walkers.length; i += 1) {
          const wkr = walkers[i];
          const delay = hash(wkr.wSeed + 3) * 0.28;
          const blend = smoothstep(delay, 0.78 + delay * 0.18, morphBlendRef.current);
          wkr.nx = wkr.ax + (wkr.bx - wkr.ax) * blend;
          wkr.ny = wkr.ay + (wkr.by - wkr.ay) * blend;
          wkr.hx = ox + wkr.nx * fit;
          wkr.hy = oy + wkr.ny * fit;
          // Place fresh walkers on the logo once we have real bounds (>1px) → the
          // shape reads instantly instead of walking in from a stale spawn point.
          if (!wkr.placed && cssW > 2) {
            wkr.x = wkr.hx + (Math.random() - 0.5) * fit * 0.05;
            wkr.y = wkr.hy + (Math.random() - 0.5) * fit * 0.05;
            wkr.vx = 0;
            wkr.vy = 0;
            wkr.placed = true;
          }
          wkr.held = false;

          // Carried by a pinch: hang from the fingers, legs scrambling in the air.
          const carrier = grabbedBy.get(i);
          if (carrier) {
            wkr.held = true;
            wkr.chat = 0;
            wkr.x = carrier.pinchX + Math.sin(t * 4.6 + wkr.wSeed) * figureSize * 0.05;
            wkr.y = carrier.pinchY + figureSize * 0.24;
            wkr.vx = carrier.vx; // inherited so a release becomes a throw
            wkr.vy = carrier.vy;
            wkr.fall = 0;
            wkr.disp = 1;
            wkr.heat += (1 - wkr.heat) * clamp(0.35 * dt, 0, 1);
            wkr.phase = (wkr.phase + 0.42 * dt) % twoPi;
            if (carrier.vx > 0.3) {
              wkr.face = 1;
            } else if (carrier.vx < -0.3) {
              wkr.face = -1;
            }
            continue;
          }

          // Dropped: a short tumble under gravity, then lie where they landed.
          if (wkr.fall > 0) {
            wkr.vy += 0.55 * dt;
            wkr.vx *= Math.pow(0.94, dt);
            wkr.x += wkr.vx * dt;
            wkr.y += wkr.vy * dt;
            wkr.fall = Math.max(0, wkr.fall - dt / 24);
            if (wkr.fall === 0) {
              wkr.vx = 0;
              wkr.vy = 0;
            }
            wkr.heat += (0.6 - wkr.heat) * clamp(0.12 * dt, 0, 1);
            wkr.phase = (wkr.phase + 0.5 * dt) % twoPi;
            continue;
          }

          // Hand influences. Open palms shove — and their forces SUM, so two palms
          // closing in squeeze the crowd caught between them. A fist gathers instead
          // (strongest one wins); pinch/point hands exert no field at all.
          let pushX = 0;
          let pushY = 0;
          let pushInfl = 0;
          let pushMark = 0;
          let gatherInfl = 0;
          let gatherX = 0;
          let gatherY = 0;
          let watchInfl = 0;
          let watchX = 0;
          let watchY = 0;
          for (let hi = 0; hi < hands.length; hi += 1) {
            const h = hands[hi];
            if (h.active <= 0.01) continue;
            if (h.gesture === "pinch" || h.gesture === "point") continue;
            const ddx = wkr.x - h.x;
            const ddy = wkr.y - h.y;
            const d = Math.hypot(ddx, ddy);
            if (h.gesture === "fist") {
              const gatherRadius = handRadius * 1.35;
              if (d >= gatherRadius) continue;
              const r = 1 - d / gatherRadius;
              const f = r * r * (3 - 2 * r) * h.active;
              if (f > gatherInfl) {
                gatherInfl = f;
                gatherX = h.x;
                gatherY = h.y;
              }
              continue;
            }
            // An open palm hovering still for ~a second stops shoving and turns
            // into a curiosity: nearby walkers wander over to have a look.
            if (h.still > 55) {
              const watchRadius = handRadius * 1.5;
              if (d >= watchRadius) continue;
              const r = 1 - d / watchRadius;
              const f = r * r * (3 - 2 * r) * h.active;
              if (f > watchInfl) {
                watchInfl = f;
                watchX = h.x;
                watchY = h.y;
              }
              continue;
            }
            if (d >= handRadius) continue;
            const r = 1 - d / handRadius;
            const f = r * r * (3 - 2 * r) * h.active; // smooth: strong core, soft edge
            const handSpd = Math.hypot(h.vx, h.vy);
            const radial =
              ddx === 0 && ddy === 0 ? hash(wkr.wSeed) * twoPi : Math.atan2(ddy, ddx);
            let pushAng = radial;
            if (handSpd > 0.25) {
              // Blend "away from hand" with the hand's sweep direction, weighting the
              // sweep more as it moves faster → people are shoved AHEAD into a pile.
              const w = clamp(handSpd / handFullSpeed, 0, 1);
              const bx = Math.cos(radial) * (1 - w) + (h.vx / handSpd) * w;
              const by = Math.sin(radial) * (1 - w) + (h.vy / handSpd) * w;
              pushAng = Math.atan2(by, bx);
            }
            const drive = clamp(handSpd / handFullSpeed, 0.16, 1);
            // Messy panic: a per-walker, time-varying heading wobble (only while the
            // hand actually moves) so they scatter chaotically, not in lockstep.
            const wobble = snoise(t * 2.3, wkr.wSeed * 1.7) * panicNoise * drive;
            const ang = pushAng + (hash(wkr.wSeed) - 0.5) * pushJitter + wobble;
            // Quicken the pace while actively shoved — varied per person, never uniform.
            const panic = 1 + panicGain * drive * f * (0.7 + hash(wkr.wSeed + 3) * 0.7);
            const pace = fleeSpeed * wkr.sMul * f * drive * panic;
            pushX += Math.cos(ang) * pace;
            pushY += Math.sin(ang) * pace;
            pushInfl = Math.max(pushInfl, f);
            pushMark = Math.max(pushMark, f * drive);
          }

          const followTo = followTargets.get(i);

          let heatTarget: number;
          if (pushInfl > 0.02) {
            // Shoved by open palm(s) — cap the summed target so two hands can't fling.
            const mag = Math.hypot(pushX, pushY);
            const cap = fleeSpeed * wkr.sMul * 1.55;
            if (mag > cap) {
              pushX *= cap / mag;
              pushY *= cap / mag;
            }
            wkr.vx += (pushX - wkr.vx) * fleeAccel * dt;
            wkr.vy += (pushY - wkr.vy) * fleeAccel * dt;
            wkr.chat = 0;
            if (pushMark > 0.1) {
              wkr.disp = 1;
            }
            heatTarget = clamp(pushInfl * 1.5, 0, 1);
          } else if (followTo) {
            // Conga line: march after your assigned breadcrumb.
            const dx = followTo.x - wkr.x;
            const dy = followTo.y - wkr.y;
            const dist = Math.hypot(dx, dy) || 1;
            const want = Math.min(returnSpeed * 1.5, dist * 0.15) * wkr.sMul;
            wkr.vx += ((dx / dist) * want - wkr.vx) * 0.15 * dt;
            wkr.vy += ((dy / dist) * want - wkr.vy) * 0.15 * dt;
            wkr.vx *= homeDamping;
            wkr.vy *= homeDamping;
            wkr.disp = 0; // mobilized — when the line dissolves they stroll home
            wkr.chat = 0;
            heatTarget = 0.35;
          } else if (gatherInfl > 0.03) {
            // Fist: come stand in a loose ring around it, follow when it moves.
            const stopDist = figureSize * (0.85 + hash(wkr.wSeed + 5) * 0.9);
            const dx = gatherX - wkr.x;
            const dy = gatherY - wkr.y;
            const dist = Math.hypot(dx, dy) || 1;
            const inward = dist - stopDist;
            if (inward > 1) {
              const want = Math.min(returnSpeed * 1.6, inward * 0.16) * wkr.sMul;
              wkr.vx += ((dx / dist) * want - wkr.vx) * 0.16 * dt;
              wkr.vy += ((dy / dist) * want - wkr.vy) * 0.16 * dt;
            } else {
              wkr.vx *= pileDamping;
              wkr.vy *= pileDamping;
            }
            wkr.disp = 0; // engaged with the fist, not shoved debris
            wkr.chat = 0;
            heatTarget = 0.45 * gatherInfl + 0.15;
          } else if (watchInfl > 0.04) {
            // Curiosity: amble over to a still hand and stand in a loose circle
            // around it, facing it — a crowd gathering to see what's going on.
            const stopDist = handRadius * (0.55 + hash(wkr.wSeed + 11) * 0.4);
            const dx = watchX - wkr.x;
            const dy = watchY - wkr.y;
            const dist = Math.hypot(dx, dy) || 1;
            const inward = dist - stopDist;
            if (inward > 2) {
              const want = Math.min(returnSpeed * 0.75, inward * 0.07) * wkr.sMul;
              wkr.vx += ((dx / dist) * want - wkr.vx) * 0.08 * dt;
              wkr.vy += ((dy / dist) * want - wkr.vy) * 0.08 * dt;
              wkr.vx *= homeDamping;
              wkr.vy *= homeDamping;
            } else {
              wkr.vx *= pileDamping;
              wkr.vy *= pileDamping;
              wkr.face = watchX >= wkr.x ? 1 : -1;
            }
            wkr.disp = 0;
            wkr.chat = 0;
            heatTarget = 0.18;
          } else if (wkr.disp > 0.5) {
            // Shoved aside, hand no longer on them → hold as a heap. Pile persists while
            // a hand is still on screen; fades the instant it leaves → they walk home.
            if (!handActive) {
              wkr.disp = Math.max(0, wkr.disp - releaseFade * dt);
            }
            wkr.vx *= pileDamping;
            wkr.vy *= pileDamping;
            heatTarget = 0.3;
          } else if (wkr.chat > 0) {
            // Stopped for a chance chat: stand facing the partner, then move on.
            wkr.chat = Math.max(0, wkr.chat - dt);
            wkr.vx *= pileDamping;
            wkr.vy *= pileDamping;
            wkr.face = wkr.chatDir;
            heatTarget = 0.12;
          } else {
            // Walk home at the chosen stroll pace — brisk while far, easing as they
            // arrive. They DON'T beeline: a per-person side bias + a slow meander curve
            // the route (a "walking around" feel) and it straightens out near home.
            const tx = wkr.hx + snoise(t * 0.5, wkr.wSeed) * swayAmp;
            const ty = wkr.hy + snoise(t * 0.5 + 17.3, wkr.wSeed + 4) * swayAmp;
            const dx = tx - wkr.x;
            const dy = ty - wkr.y;
            const dist = Math.hypot(dx, dy) || 1;
            const want = Math.min(returnSpeed, dist * returnStiffness) * wkr.sMul;
            const inv = 1 / dist;
            let nx = dx * inv;
            let ny = dy * inv;
            // Curve fades to zero near home so they converge; far away they sweep wide.
            const arc = wanderAmt * clamp(dist / (spacing * 5), 0, 1);
            if (arc > 0.001) {
              const side = (hash(wkr.wSeed + 9) - 0.5) * 2;
              const meander = snoise(t * 0.22, wkr.wSeed * 1.7);
              // Rotate the heading, bounded < ~70° so a homeward component always remains.
              const turn = clamp((side * 0.7 + meander * 0.9) * arc, -1.2, 1.2);
              const c = Math.cos(turn);
              const s = Math.sin(turn);
              const rx = nx * c - ny * s;
              const ry = nx * s + ny * c;
              nx = rx;
              ny = ry;
            }
            wkr.vx += (nx * want - wkr.vx) * returnAccel * dt;
            wkr.vy += (ny * want - wkr.vy) * returnAccel * dt;
            wkr.vx *= homeDamping;
            wkr.vy *= homeDamping;
            heatTarget = 0;
          }

          const sp = Math.hypot(wkr.vx, wkr.vy);
          if (sp > maxSpeed) {
            const k = maxSpeed / sp;
            wkr.vx *= k;
            wkr.vy *= k;
          }

          wkr.x += wkr.vx * dt;
          wkr.y += wkr.vy * dt;

          // Heat → color: hand on them = Hot, piled = Field-warm, calm/returning cools
          // back to Core. Rises fast (a startle), falls slowly (cooling as they settle).
          const heatRate = heatTarget > wkr.heat ? 0.3 : 0.05;
          wkr.heat += (heatTarget - wkr.heat) * clamp(heatRate * dt, 0, 1);

          // Foot-locked gait: the leg cycle advances with DISTANCE travelled, so each
          // stride covers the ground it visually should — they move exactly as fast as
          // they walk (no gliding / moonwalking). A faint idle shuffle keeps the standing
          // crowd alive and fades out the instant they start walking.
          const idleVar = 0.55 + hash(wkr.wSeed + 7) * 0.9;
          const travelPhase = (sp / strideCycle) * twoPi * dt;
          const idleFade = clamp(1 - sp / 0.6, 0, 1);
          wkr.phase =
            (wkr.phase + travelPhase + idleRate * idleVar * idleFade * dt) % twoPi;
          if (wkr.vx > 0.3) {
            wkr.face = 1;
          } else if (wkr.vx < -0.3) {
            wkr.face = -1;
          }
        }
      }

      // --- Render ---
      if (!captureCleanRef.current && video && video.readyState >= 2) {
        drawCover(video);
        ctx.fillStyle = "rgba(2, 5, 10, 0.46)";
        ctx.fillRect(0, 0, cssW, cssH);
      } else {
        ctx.fillStyle = "#04060a";
        ctx.fillRect(0, 0, cssW, cssH);
      }

      // Draw at the figure size used for the gait foot-lock above (kept identical so the
      // stride matches the rendered legs). Neighbours slightly overlap → continuous fills.
      const size = figureSize;
      const half = size / 2;
      ctx.imageSmoothingEnabled = true;
      // Back-to-front: smaller y (farther) drawn first, larger y (nearer) drawn last,
      // so the front row occludes the rows behind it — consistent depth in the crowd.
      // A carried walker is lifted above everyone, so it always draws on top.
      if (drawOrder.length !== walkers.length) {
        drawOrder = walkers.map((_, idx) => idx);
      }
      drawOrder.sort(
        (a, b) =>
          walkers[a].y +
          (walkers[a].held ? 1e5 : 0) -
          (walkers[b].y + (walkers[b].held ? 1e5 : 0))
      );
      for (let oi = 0; oi < drawOrder.length; oi += 1) {
        const wkr = walkers[drawOrder[oi]];
        let f = Math.floor((wkr.phase / twoPi) * WALK_FRAMES) % WALK_FRAMES;
        if (f < 0) {
          f += WALK_FRAMES;
        }
        const sx = f * SPRITE_CELL;
        const heatStep = clamp(Math.round(wkr.heat * (PALETTE_STEPS - 1)), 0, PALETTE_STEPS - 1);
        const sy = (heatStep * GENDERS + wkr.gender) * SPRITE_CELL;
        if (wkr.held || wkr.fall > 0) {
          // A held walker sways; a released walker briefly tumbles.
          ctx.save();
          ctx.translate(wkr.x, wkr.y);
          const tilt = wkr.held
            ? Math.sin(now * 0.004 + wkr.wSeed) * 0.28
            : (1 - wkr.fall) * 1.3 * wkr.face;
          ctx.rotate(tilt);
          if (wkr.face < 0) {
            ctx.scale(-1, 1);
          }
          ctx.drawImage(walkerSheet, sx, sy, SPRITE_CELL, SPRITE_CELL, -half, -half, size, size);
          ctx.restore();
        } else if (wkr.face < 0) {
          ctx.save();
          ctx.translate(wkr.x, wkr.y);
          ctx.scale(-1, 1);
          ctx.drawImage(walkerSheet, sx, sy, SPRITE_CELL, SPRITE_CELL, -half, -half, size, size);
          ctx.restore();
        } else {
          ctx.drawImage(walkerSheet, sx, sy, SPRITE_CELL, SPRITE_CELL, wkr.x - half, wkr.y - half, size, size);
        }
      }
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
    };
  }, [walkerSheet, handsRef, videoRef]);

  return (
    <div ref={containerRef} className="webcam-walkers-overlay" aria-hidden="true">
      <canvas ref={canvasRef} className="webcam-walkers-canvas" />
      <div
        className={`webcam-walkers-status status-${status}`}
        role="status"
        hidden={captureClean}
      >
        {status === "requesting" && "Requesting camera…"}
        {status === "active" &&
          (modelReady
            ? "Walkers · open hand pushes · fist gathers · pinch lifts · finger leads"
            : "Loading hand tracker…")}
        {status === "denied" && "Camera denied — crowd marches in place"}
        {status === "unsupported" && "Camera needs HTTPS or localhost"}
        {status === "error" && "Camera unavailable — crowd marches in place"}
      </div>
    </div>
  );
}
