import { useEffect, useMemo, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { sampleSvgToParticles } from "./svgSampler";
import { LOGO_CONTENT_WORLD_SIZE } from "./sceneSizing";
import type { ParticleSettings } from "./types";

// A tracked hand: smoothed screen-space position + velocity (px / 60fps-frame).
// active fades to 0 the moment the hand leaves frame, so the crowd then walks home.
type Hand = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: number;
  seen: number;
};

type WebcamWalkersOverlayProps = {
  svgText: string;
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
};

type CameraStatus =
  | "idle"
  | "requesting"
  | "active"
  | "denied"
  | "unsupported"
  | "error";

// MediaPipe HandLandmarker assets, bundled in public/ so it works on LAN / offline.
const MP_WASM_PATH = "/mediapipe/wasm";
const MP_HAND_MODEL = "/mediapipe/hand_landmarker.task";

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
  settings,
  replayNonce,
  paused
}: WebcamWalkersOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [modelReady, setModelReady] = useState(false);

  const walkerSheet = useMemo(
    () =>
      buildWalkerSheet(
        settings.particleColor,
        settings.particleAccentColor,
        settings.particleHighlightColor
      ),
    [settings.particleColor, settings.particleAccentColor, settings.particleHighlightColor]
  );

  // Sample the SVG onto an EVEN GRID so the crowd covers the shape uniformly.
  // (Random sampling left gaps on thin stroke-only outlines — drawn SVGs — making
  // them look "unclosed". Snapping a dense sample to a grid keeps lines continuous.)
  const homes = useMemo(() => {
    const grid = clamp(Math.round(46 * Math.sqrt(settings.particleCount / 8000)), 40, 104);
    try {
      const denseCount = clamp(settings.particleCount, 6000, 18000);
      const raw = sampleSvgToParticles(svgText, denseCount, 11);
      const seen = new Set<number>();
      const out: Array<{ nx: number; ny: number }> = [];
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
          // Snap to the cell centre so the lattice is perfectly even.
          out.push({ nx: gx / grid, ny: gy / grid });
        }
      }
      return { points: out, grid };
    } catch {
      return { points: [] as Array<{ nx: number; ny: number }>, grid };
    }
  }, [svgText, settings.particleCount]);

  // Latest props available to the rAF loop without restarting it.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const homesRef = useRef(homes);
  const gridRef = useRef(homes.grid);
  const walkersRef = useRef<Walker[]>([]);

  // MediaPipe hand tracker — only the HAND pushes the crowd (a face/any motion is
  // ignored, unlike optical flow), so it can clear, pile, and reliably return.
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraActive = useRef(false);

  // Rebuild walkers whenever the logo shape / count changes.
  useEffect(() => {
    homesRef.current = homes;
    gridRef.current = homes.grid;
    const view = containerRef.current?.getBoundingClientRect();
    const w = view?.width ?? window.innerWidth;
    const h = view?.height ?? window.innerHeight;
    const fit = Math.min(w, h) * 0.78;
    const ox = w / 2 - fit / 2;
    const oy = h / 2 - fit / 2;

    const prev = walkersRef.current;
    const next: Walker[] = homes.points.map((home, i) => {
      const hx = ox + home.nx * fit;
      const hy = oy + home.ny * fit;
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
        nx: home.nx,
        ny: home.ny,
        phase: old ? old.phase : Math.random() * Math.PI * 2,
        face: old ? old.face : Math.random() < 0.5 ? -1 : 1,
        sMul: old ? old.sMul : 0.74 + Math.random() * 0.52,
        wSeed: old ? old.wSeed : Math.random() * 1000,
        placed: old ? old.placed : false,
        disp: old ? old.disp : 0,
        gender: old ? old.gender : Math.random() < 0.5 ? 0 : 1,
        heat: old ? old.heat : 0
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

  // Camera lifecycle — runs once while this style is mounted.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    videoRef.current = video;

    setStatus("requesting");
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      })
      .then(async (mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        video.srcObject = mediaStream;
        await video.play();
        cameraActive.current = true;
        setStatus("active");
      })
      .catch((err: DOMException) => {
        if (cancelled) {
          return;
        }
        cameraActive.current = false;
        setStatus(
          err?.name === "NotAllowedError" || err?.name === "SecurityError"
            ? "denied"
            : "error"
        );
      });

    return () => {
      cancelled = true;
      cameraActive.current = false;
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      videoRef.current = null;
    };
  }, []);

  // Load the MediaPipe hand model once (GPU, falling back to CPU). Assets are local.
  useEffect(() => {
    let cancelled = false;
    let landmarker: HandLandmarker | null = null;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(MP_WASM_PATH);
        const make = (delegate: "GPU" | "CPU") =>
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MP_HAND_MODEL, delegate },
            runningMode: "VIDEO",
            numHands: 2
          });
        try {
          landmarker = await make("GPU");
        } catch {
          landmarker = await make("CPU");
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        handLandmarkerRef.current = landmarker;
        setModelReady(true);
      } catch {
        if (!cancelled) {
          setModelReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      handLandmarkerRef.current = null;
      landmarker?.close();
    };
  }, []);

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
    let lastDetectTs = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0;
    let cssH = 0;
    // Grace (60fps-frame units) so a 1-frame detection dropout doesn't make the crowd
    // bolt home; stays >0 while a hand is in frame, decays once the hand leaves.
    let handHold = 0;
    // Persistent tracked hands (≤2), kept across frames so we can derive velocity.
    const hands: Hand[] = [];
    // Painter's-order index buffer (sorted back→front by y each frame) so people lower
    // on screen (nearer) correctly occlude those behind. Reused to avoid GC churn.
    let drawOrder: number[] = [];

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

    // Map a normalized landmark (raw video space) to on-screen px, matching drawCover's
    // cover-scaling + mirror so the push lines up exactly with the hand you see.
    const landmarkToScreen = (lx: number, ly: number, out: { x: number; y: number }) => {
      const v = videoRef.current;
      const sw = v?.videoWidth || 640;
      const sh = v?.videoHeight || 480;
      const scale = Math.max(cssW / sw, cssH / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const nx = mirror ? 1 - lx : lx;
      out.x = (cssW - dw) / 2 + nx * dw;
      out.y = (cssH - dh) / 2 + ly * dh;
    };

    // Fold this frame's detected hands into the persistent list (nearest-match so each
    // hand keeps its velocity); hands not seen this frame fade out → crowd walks home.
    const syncHands = (detected: Array<{ x: number; y: number }>, dt: number) => {
      for (let i = 0; i < hands.length; i += 1) {
        hands[i].seen = 0;
      }
      const maxJump = Math.min(cssW, cssH) * 0.5;
      for (const d of detected) {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < hands.length; i += 1) {
          if (hands[i].seen) continue;
          const dd = (hands[i].x - d.x) ** 2 + (hands[i].y - d.y) ** 2;
          if (dd < bestD) {
            bestD = dd;
            best = i;
          }
        }
        if (best >= 0 && bestD < maxJump * maxJump) {
          const h = hands[best];
          h.vx = h.vx * 0.5 + ((d.x - h.x) / dt) * 0.5;
          h.vy = h.vy * 0.5 + ((d.y - h.y) / dt) * 0.5;
          h.x = d.x;
          h.y = d.y;
          h.active = 1;
          h.seen = 1;
        } else {
          hands.push({ x: d.x, y: d.y, vx: 0, vy: 0, active: 1, seen: 1 });
        }
      }
      for (let i = hands.length - 1; i >= 0; i -= 1) {
        if (!hands[i].seen) {
          hands[i].active = Math.max(0, hands[i].active - dt * 0.5);
          hands[i].vx *= 0.85;
          hands[i].vy *= 0.85;
          if (hands[i].active <= 0.001) {
            hands.splice(i, 1);
          }
        }
      }
    };

    const detected: Array<{ x: number; y: number }> = [];
    const tmpPt = { x: 0, y: 0 };
    // Palm landmarks (wrist + finger bases) — their mean is a stable hand centre.
    const PALM = [0, 1, 5, 9, 13, 17];

    const detectHands = (now: number, dt: number) => {
      const lm = handLandmarkerRef.current;
      const video = videoRef.current;
      detected.length = 0;
      if (lm && cameraActive.current && video && video.readyState >= 2) {
        // detectForVideo needs a strictly increasing timestamp (ms).
        const ts = now <= lastDetectTs ? lastDetectTs + 1 : now;
        lastDetectTs = ts;
        let result: ReturnType<HandLandmarker["detectForVideo"]> | null = null;
        try {
          result = lm.detectForVideo(video, ts);
        } catch {
          result = null;
        }
        if (result) {
          for (const hand of result.landmarks) {
            let mx = 0;
            let my = 0;
            for (const p of PALM) {
              mx += hand[p].x;
              my += hand[p].y;
            }
            landmarkToScreen(mx / PALM.length, my / PALM.length, tmpPt);
            detected.push({ x: tmpPt.x, y: tmpPt.y });
          }
        }
      }
      syncHands(detected, dt);
    };

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

      detectHands(now, dt);

      const cfg = settingsRef.current;
      const walkers = walkersRef.current;
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
      // panicGain = extra pace, panicNoise = time-varying heading wobble (radians),
      // fleeCadence = extra leg-pumping so the steps read as hurried, not a glide.
      const panicGain = 0.25 + clamp(cfg.mouseForce, 0, 3) * 0.3;
      const panicNoise = 0.32 + clamp(cfg.turbulence, 0, 1) * 0.95;
      const fleeCadence = 0.55 + cfg.animationSpeed * 0.6;
      // Return is BRISK when far (hurrying back) and eases near home.
      const returnSpeed = (2.4 + cfg.attractRadius * 2.4) * cssW * 0.0016;
      const returnStiffness = clamp(0.07 + cfg.attractRadius * 0.06, 0.05, 0.18);
      const returnAccel = clamp(0.2 + cfg.attractRadius * 0.12, 0.16, 0.36);
      const homeDamping = Math.pow(0.86, dt);
      // Shoved aside then left alone → a step or two and stop, standing as a pile.
      const pileDamping = Math.pow(0.82, dt);
      const maxSpeed = Math.max(fleeSpeed * (1 + panicGain), returnSpeed) * 1.3;
      const idleRate = 0.05 * Math.max(0.15, cfg.animationSpeed);
      // Legs pump with actual travel speed → a real walk cadence when they move.
      const travelGain = 0.085 * Math.max(0.4, cfg.animationSpeed);
      // Once the hand LEAVES the frame, displacement fades → they commit to walking
      // home; while a hand is still on screen, piles persist (worked area stays clean).
      const releaseFade = clamp(0.085 * Math.max(0.3, cfg.animationSpeed * 2), 0.04, 0.2);
      // Bounded sway around home → the standing crowd shuffles without drifting away.
      const spacing = (Math.min(cssW, cssH) * 0.78) / Math.max(1, gridRef.current);
      const swayAmp = spacing * (0.12 + cfg.turbulence * 0.5);
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

      if (!pausedRef.current) {
        for (let i = 0; i < walkers.length; i += 1) {
          const wkr = walkers[i];
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
          // Which hand acts hardest on this walker? (localized → only the swept band
          // moves; everyone else holds formation, so no whole-crowd scatter.)
          let infl = 0;
          let pushAng = 0;
          let handSpd = 0;
          for (let hi = 0; hi < hands.length; hi += 1) {
            const h = hands[hi];
            if (h.active <= 0.01) continue;
            const ddx = wkr.x - h.x;
            const ddy = wkr.y - h.y;
            const d = Math.hypot(ddx, ddy);
            if (d >= handRadius) continue;
            const r = 1 - d / handRadius;
            const f = r * r * (3 - 2 * r) * h.active; // smooth: strong core, soft edge
            if (f > infl) {
              infl = f;
              handSpd = Math.hypot(h.vx, h.vy);
              const radial =
                ddx === 0 && ddy === 0 ? hash(wkr.wSeed) * twoPi : Math.atan2(ddy, ddx);
              if (handSpd > 0.25) {
                // Blend "away from hand" with the hand's sweep direction, weighting the
                // sweep more as it moves faster → people are shoved AHEAD into a pile.
                const w = clamp(handSpd / handFullSpeed, 0, 1);
                const bx = Math.cos(radial) * (1 - w) + (h.vx / handSpd) * w;
                const by = Math.sin(radial) * (1 - w) + (h.vy / handSpd) * w;
                pushAng = Math.atan2(by, bx);
              } else {
                pushAng = radial;
              }
            }
          }

          // Hand on them → turn and WALK away. Strength scales with proximity AND hand
          // speed, so a sweep shoves hard while a resting hand only nudges.
          let legBoost = 0;
          if (infl > 0.02) {
            const drive = clamp(handSpd / handFullSpeed, 0.16, 1);
            // Messy panic: a per-walker, time-varying heading wobble (only while the
            // hand actually moves) so they scatter chaotically, not in lockstep.
            const wobble = snoise(t * 2.3, wkr.wSeed * 1.7) * panicNoise * drive;
            const ang = pushAng + (hash(wkr.wSeed) - 0.5) * pushJitter + wobble;
            // Quicken the pace while actively shoved — varied per person, never uniform.
            const panic = 1 + panicGain * drive * infl * (0.7 + hash(wkr.wSeed + 3) * 0.7);
            const pace = fleeSpeed * wkr.sMul * infl * drive * panic;
            wkr.vx += (Math.cos(ang) * pace - wkr.vx) * fleeAccel * dt;
            wkr.vy += (Math.sin(ang) * pace - wkr.vy) * fleeAccel * dt;
            legBoost = drive * infl;
            if (infl * drive > 0.1) {
              wkr.disp = 1;
            }
          } else if (wkr.disp > 0.5) {
            // Shoved aside, hand no longer on them → hold as a heap. Pile persists while
            // a hand is still on screen; fades the instant it leaves → they walk home.
            if (!handActive) {
              wkr.disp = Math.max(0, wkr.disp - releaseFade * dt);
            }
            wkr.vx *= pileDamping;
            wkr.vy *= pileDamping;
          } else {
            // Walk home — speed scales with distance (brisk far, easing near) and with
            // how settled they are, capped at a hurried walking pace.
            const tx = wkr.hx + snoise(t * 0.5, wkr.wSeed) * swayAmp;
            const ty = wkr.hy + snoise(t * 0.5 + 17.3, wkr.wSeed + 4) * swayAmp;
            const dx = tx - wkr.x;
            const dy = ty - wkr.y;
            const dist = Math.hypot(dx, dy) || 1;
            const want = Math.min(returnSpeed, dist * returnStiffness) * wkr.sMul;
            const inv = 1 / dist;
            wkr.vx += (dx * inv * want - wkr.vx) * returnAccel * dt;
            wkr.vy += (dy * inv * want - wkr.vy) * returnAccel * dt;
            wkr.vx *= homeDamping;
            wkr.vy *= homeDamping;
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
          const heatTarget = clamp(infl * 1.5 + (wkr.disp > 0.5 ? 0.3 : 0), 0, 1);
          const heatRate = heatTarget > wkr.heat ? 0.3 : 0.05;
          wkr.heat += (heatTarget - wkr.heat) * clamp(heatRate * dt, 0, 1);

          // Leg cycle is driven by travel speed (reads as walking) + a frantic boost
          // while the hand shoves them (quick, hurried steps), plus a per-walker idle.
          const idleVar = 0.55 + hash(wkr.wSeed + 7) * 0.9;
          wkr.phase =
            (wkr.phase +
              (idleRate * idleVar + sp * travelGain + legBoost * fleeCadence) * dt) %
            twoPi;
          if (wkr.vx > 0.3) {
            wkr.face = 1;
          } else if (wkr.vx < -0.3) {
            wkr.face = -1;
          }
        }
      }

      // --- Render ---
      if (cameraActive.current && video) {
        drawCover(video);
        ctx.fillStyle = "rgba(2, 5, 10, 0.46)";
        ctx.fillRect(0, 0, cssW, cssH);
      } else {
        ctx.fillStyle = "#04060a";
        ctx.fillRect(0, 0, cssW, cssH);
      }

      // Size from the lattice spacing so neighbours slightly overlap → continuous
      // strokes and solid fills (no broken outlines), consistent across any SVG.
      const latticeSpacing = (Math.min(cssW, cssH) * 0.78) / Math.max(1, gridRef.current);
      const baseSize = clamp(latticeSpacing * 1.7, 8, 46);
      const size = baseSize * clamp(cfg.pointSize / 1.6, 0.55, 2.6);
      const half = size / 2;
      ctx.imageSmoothingEnabled = true;
      // Back-to-front: smaller y (farther) drawn first, larger y (nearer) drawn last,
      // so the front row occludes the rows behind it — consistent depth in the crowd.
      if (drawOrder.length !== walkers.length) {
        drawOrder = walkers.map((_, idx) => idx);
      }
      drawOrder.sort((a, b) => walkers[a].y - walkers[b].y);
      for (let oi = 0; oi < drawOrder.length; oi += 1) {
        const wkr = walkers[drawOrder[oi]];
        let f = Math.floor((wkr.phase / twoPi) * WALK_FRAMES) % WALK_FRAMES;
        if (f < 0) {
          f += WALK_FRAMES;
        }
        const sx = f * SPRITE_CELL;
        const heatStep = clamp(Math.round(wkr.heat * (PALETTE_STEPS - 1)), 0, PALETTE_STEPS - 1);
        const sy = (heatStep * GENDERS + wkr.gender) * SPRITE_CELL;
        if (wkr.face < 0) {
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
  }, [walkerSheet]);

  return (
    <div ref={containerRef} className="webcam-walkers-overlay" aria-hidden="true">
      <canvas ref={canvasRef} className="webcam-walkers-canvas" />
      <div className={`webcam-walkers-status status-${status}`} role="status">
        {status === "requesting" && "Requesting camera…"}
        {status === "active" &&
          (modelReady
            ? "Walkers · move your hand to push the crowd"
            : "Loading hand tracker…")}
        {status === "denied" && "Camera denied — crowd marches in place"}
        {status === "unsupported" && "Camera needs HTTPS or localhost"}
        {status === "error" && "Camera unavailable — crowd marches in place"}
      </div>
    </div>
  );
}
