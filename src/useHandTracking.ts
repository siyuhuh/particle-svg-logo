import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { readHandGesture, type GestureRead, type HandGesture } from "./handGestures";

// MediaPipe HandLandmarker assets, bundled in public/ so it works on LAN / offline.
const MP_WASM_PATH = "/mediapipe/wasm";
const MP_HAND_MODEL = "/mediapipe/hand_landmarker.task";

// A gesture must hold for this many detection frames before it switches — keeps
// half-formed transitions (open→fist passes through "point") from flickering.
const GESTURE_STREAK = 3;

export type CameraStatus =
  | "idle"
  | "requesting"
  | "active"
  | "denied"
  | "unsupported"
  | "error";

// A tracked hand: smoothed view-local position + velocity (px / 60fps-frame).
// active fades to 0 the moment the hand leaves frame.
export type TrackedHand = {
  /** Palm centre, css px local to the view element. */
  x: number;
  y: number;
  /** Palm velocity, px per 60fps frame. */
  vx: number;
  vy: number;
  active: number;
  seen: number;
  /** Debounced gesture. */
  gesture: HandGesture;
  /** Thumb↔index midpoint, view-local css px. */
  pinchX: number;
  pinchY: number;
  /** Index fingertip, view-local css px. */
  tipX: number;
  tipY: number;
  rawGesture: HandGesture;
  rawStreak: number;
  /** Walkers: index of the walker this hand is pinching, -1 = none. */
  grabbedIndex: number;
  /** Walkers: fingertip breadcrumb trail while pointing (conga line). */
  trail: Array<{ x: number; y: number }>;
  /** Walkers: walker indices marching along the trail, in recruit order. */
  followers: number[];
};

type UseHandTrackingOptions = {
  enabled: boolean;
  /** Element whose bounds define the cover-fit mapping from video to screen. */
  viewRef: RefObject<HTMLElement | null>;
};

type DetectedHand = GestureRead & { x: number; y: number };

const MIRROR = true;

export function useHandTracking({ enabled, viewRef }: UseHandTrackingOptions) {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [modelReady, setModelReady] = useState(false);

  const handsRef = useRef<TrackedHand[]>([]);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraActive = useRef(false);

  // Camera lifecycle — runs while enabled.
  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
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
      handsRef.current = [];
    };
  }, [enabled]);

  // Load the MediaPipe hand model (GPU, falling back to CPU). Assets are local.
  useEffect(() => {
    if (!enabled) {
      return;
    }
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
      setModelReady(false);
    };
  }, [enabled]);

  // Detection loop — the hook owns its own rAF; consumers just read handsRef.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let raf = 0;
    let last = performance.now();
    let lastDetectTs = 0;
    let cssW = 1;
    let cssH = 1;

    // Map a normalized landmark (raw video space) to view-local px, matching the
    // cover-scaling + mirror used when the feed is drawn full-bleed, so tracked
    // points line up exactly with the hand you see.
    const landmarkToScreen = (lx: number, ly: number, out: { x: number; y: number }) => {
      const v = videoRef.current;
      const sw = v?.videoWidth || 640;
      const sh = v?.videoHeight || 480;
      const scale = Math.max(cssW / sw, cssH / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const nx = MIRROR ? 1 - lx : lx;
      out.x = (cssW - dw) / 2 + nx * dw;
      out.y = (cssH - dh) / 2 + ly * dh;
    };

    // Fold this frame's detected hands into the persistent list (nearest-match so
    // each hand keeps its velocity, gesture debounce, grabs and trail); hands not
    // seen this frame fade out.
    const hands = handsRef.current;
    const syncHands = (detected: DetectedHand[], dt: number) => {
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
          h.pinchX = d.pinchX;
          h.pinchY = d.pinchY;
          h.tipX = d.tipX;
          h.tipY = d.tipY;
          if (d.gesture === h.rawGesture) {
            h.rawStreak += 1;
          } else {
            h.rawGesture = d.gesture;
            h.rawStreak = 1;
          }
          if (h.rawStreak >= GESTURE_STREAK && h.gesture !== h.rawGesture) {
            h.gesture = h.rawGesture;
          }
        } else {
          hands.push({
            x: d.x,
            y: d.y,
            vx: 0,
            vy: 0,
            active: 1,
            seen: 1,
            gesture: d.gesture,
            pinchX: d.pinchX,
            pinchY: d.pinchY,
            tipX: d.tipX,
            tipY: d.tipY,
            rawGesture: d.gesture,
            rawStreak: 1,
            grabbedIndex: -1,
            trail: [],
            followers: []
          });
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

    const detected: DetectedHand[] = [];
    const tmpPt = { x: 0, y: 0 };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(2.2, Math.max(0.2, (now - last) / 16.667));
      last = now;

      const bounds = viewRef.current?.getBoundingClientRect();
      if (bounds && bounds.width > 1) {
        cssW = bounds.width;
        cssH = bounds.height;
      }

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
          const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
          for (const hand of result.landmarks) {
            const read = readHandGesture(hand, aspect);
            landmarkToScreen(read.palmX, read.palmY, tmpPt);
            const d: DetectedHand = { ...read, x: tmpPt.x, y: tmpPt.y };
            landmarkToScreen(read.pinchX, read.pinchY, tmpPt);
            d.pinchX = tmpPt.x;
            d.pinchY = tmpPt.y;
            landmarkToScreen(read.tipX, read.tipY, tmpPt);
            d.tipX = tmpPt.x;
            d.tipY = tmpPt.y;
            detected.push(d);
          }
        }
      }
      syncHands(detected, dt);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [enabled, viewRef]);

  return { handsRef, status, modelReady, videoRef };
}
