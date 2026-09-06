// Geometric gesture classification from MediaPipe HandLandmarker's 21 landmarks.
// No extra model: the bundled hand_landmarker.task stays the only vision asset,
// so the app keeps working fully offline / on LAN.

export type HandGesture = "open" | "fist" | "pinch" | "point";

export type HandLandmark = { x: number; y: number };

export type GestureRead = {
  gesture: HandGesture;
  /** Palm centre, normalized video space. */
  palmX: number;
  palmY: number;
  /** Thumb↔index midpoint — where a pinched walker hangs. */
  pinchX: number;
  pinchY: number;
  /** Index fingertip — the point a led crowd follows. */
  tipX: number;
  tipY: number;
};

/** Wrist + finger bases — their mean is a stable hand centre. */
export const PALM_LANDMARKS = [0, 1, 5, 9, 13, 17];

const WRIST = 0;
const MIDDLE_MCP = 9;
const THUMB_TIP = 4;
// index, middle, ring, pinky tips
const FINGER_TIPS = [8, 12, 16, 20];

// Landmarks are normalized to the video frame, so x distances shrink relative to
// y on a wide frame — scale x by the frame aspect before measuring.
function dist(a: HandLandmark, b: HandLandmark, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function readHandGesture(lm: HandLandmark[], aspect: number): GestureRead {
  let palmX = 0;
  let palmY = 0;
  for (const i of PALM_LANDMARKS) {
    palmX += lm[i].x;
    palmY += lm[i].y;
  }
  palmX /= PALM_LANDMARKS.length;
  palmY /= PALM_LANDMARKS.length;

  const read: GestureRead = {
    gesture: "open",
    palmX,
    palmY,
    pinchX: (lm[THUMB_TIP].x + lm[FINGER_TIPS[0]].x) / 2,
    pinchY: (lm[THUMB_TIP].y + lm[FINGER_TIPS[0]].y) / 2,
    tipX: lm[FINGER_TIPS[0]].x,
    tipY: lm[FINGER_TIPS[0]].y
  };

  // Wrist→middle-MCP is a per-hand scale unit, invariant to distance from camera.
  const scale = dist(lm[WRIST], lm[MIDDLE_MCP], aspect);
  if (scale < 1e-4) {
    return read;
  }

  // Fingertip reach from the wrist in hand-scale units: extended fingers sit
  // around 1.7–2.1, fully curled ones fold back to roughly 0.9–1.3.
  const reach = FINGER_TIPS.map((tip) => dist(lm[tip], lm[WRIST], aspect) / scale);
  const extended = reach.map((r) => r > 1.55);
  const curled = reach.map((r) => r < 1.35);

  const pinchGap = dist(lm[THUMB_TIP], lm[FINGER_TIPS[0]], aspect) / scale;
  const restUp =
    (extended[1] ? 1 : 0) + (extended[2] ? 1 : 0) + (extended[3] ? 1 : 0);

  if (pinchGap < 0.38 && restUp >= 2) {
    // Thumb+index closed while the rest stay up — a deliberate pick, not a fist
    // (in a fist the thumb also ends up near the index tip, so require open rest).
    read.gesture = "pinch";
  } else if (extended[0] && curled[1] && curled[2] && curled[3]) {
    read.gesture = "point";
  } else if (curled[0] && curled[1] && curled[2] && curled[3]) {
    read.gesture = "fist";
  }
  return read;
}
