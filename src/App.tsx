import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  ChangeEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import {
  Brush,
  Check,
  Circle,
  Clipboard,
  Cpu,
  Expand,
  FileCode2,
  Grid3X3,
  Layers,
  Minimize2,
  Minus,
  Pause,
  PenLine,
  Play,
  RefreshCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  X
} from "lucide-react";
import { DEFAULT_SVG } from "./defaultLogo";
import { ParticleLogoScene } from "./ParticleLogoScene";
import { getRecommendedParticleCount, sampleSvgToParticles } from "./svgSampler";
import { sanitizeSvgText } from "./svgSanitize";
import type {
  FancyVariant,
  LogoSource,
  LogoStyle,
  ParticleSettings,
  RenderMode
} from "./types";

type EffectSettings = Omit<ParticleSettings, "logoStyle">;

const BASE_EFFECT_SETTINGS: EffectSettings = {
  particleColor: "#fff7e7",
  particleAccentColor: "#72f2ff",
  particleHighlightColor: "#ff9a62",
  asciiCharacters: "01<>/\\*#@",
  fancyVariant: "effect1",
  particleCount: 24000,
  pointSize: 1.6,
  turbulence: 0.2,
  scatterRadius: 0.65,
  mouseForce: 0.05,
  attractRadius: 0.5,
  repelRadius: 0.58,
  flicker: 0.15,
  breathe: 0.01,
  maskRoughness: 0,
  surfaceDepth: 0,
  animationSpeed: 0.45,
  walkerReturnSpeed: 0.4,
  walkerWander: 0.5,
  gridVisible: true,
  renderMode: "webgl"
};

const EFFECT_SETTING_PRESETS: Record<LogoStyle, EffectSettings> = {
  dust: {
    ...BASE_EFFECT_SETTINGS
  },
  ripples: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#eafcff",
    particleAccentColor: "#52eaff",
    particleHighlightColor: "#ffffff",
    particleCount: 18000,
    pointSize: 2.2,
    turbulence: 0.2,
    scatterRadius: 0.85,
    mouseForce: 0.9,
    attractRadius: 1.25,
    flicker: 0.08,
    breathe: 0.16,
    animationSpeed: 0.82
  },
  lines: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#ffffff",
    particleAccentColor: "#cfcfcf",
    particleHighlightColor: "#ffffff",
    particleCount: 10000,
    pointSize: 1.5,
    turbulence: 0.2,
    scatterRadius: 0.38,
    mouseForce: 0.45,
    attractRadius: 0.9,
    repelRadius: 0.32,
    flicker: 0.04,
    breathe: 0.03,
    animationSpeed: 0.68
  },
  metal: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#bdbab2",
    particleAccentColor: "#f7f7f4",
    particleHighlightColor: "#ffffff",
    particleCount: 9000,
    pointSize: 5.2,
    turbulence: 0.35,
    scatterRadius: 1.35,
    mouseForce: 0.8,
    attractRadius: 1,
    repelRadius: 0.32,
    flicker: 0.02,
    breathe: 0.02,
    animationSpeed: 0.58
  },
  mercury: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#d9d9d3",
    particleAccentColor: "#323232",
    particleHighlightColor: "#ffffff",
    particleCount: 10000,
    pointSize: 5.4,
    turbulence: 1.35,
    scatterRadius: 1.55,
    mouseForce: 1.4,
    attractRadius: 1.1,
    repelRadius: 0.42,
    flicker: 0.1,
    breathe: 0.06,
    maskRoughness: 0.12,
    surfaceDepth: 0.86,
    animationSpeed: 0.62
  },
  chrome: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#09090d",
    particleAccentColor: "#215cff",
    particleHighlightColor: "#ff583f",
    particleCount: 9000,
    pointSize: 3.5,
    turbulence: 0.15,
    scatterRadius: 0.6,
    mouseForce: 2.7,
    attractRadius: 0.55,
    repelRadius: 0.1,
    flicker: 0.8,
    breathe: 0.04,
    animationSpeed: 0.5
  },
  radiance: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#ff120b",
    particleAccentColor: "#ff0028",
    particleHighlightColor: "#ff8b66",
    particleCount: 12000,
    pointSize: 2.4,
    turbulence: 0.2,
    scatterRadius: 0.75,
    mouseForce: 0.55,
    attractRadius: 1.25,
    repelRadius: 0.36,
    flicker: 0.06,
    breathe: 0.06,
    animationSpeed: 0.62
  },
  dither: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f7f7f2",
    particleAccentColor: "#87f7ff",
    particleHighlightColor: "#ffffff",
    particleCount: 11000,
    pointSize: 3.6,
    turbulence: 0.45,
    scatterRadius: 0.65,
    mouseForce: 0.3,
    attractRadius: 1.05,
    repelRadius: 0.32,
    flicker: 0.08,
    breathe: 0.04,
    animationSpeed: 0.72
  },
  bulge: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f9f9f4",
    particleAccentColor: "#83f6ff",
    particleHighlightColor: "#ff6b86",
    particleCount: 10000,
    pointSize: 4.2,
    turbulence: 0.62,
    scatterRadius: 0.82,
    mouseForce: 1.35,
    attractRadius: 1.55,
    repelRadius: 0.46,
    flicker: 0.06,
    breathe: 0.05,
    surfaceDepth: 1,
    animationSpeed: 0.74
  },
  gommage: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#eccfa3",
    particleAccentColor: "#b0aa9d",
    particleHighlightColor: "#fff1d2",
    particleCount: 12000,
    pointSize: 4.4,
    turbulence: 1.15,
    scatterRadius: 1.45,
    mouseForce: 0.72,
    attractRadius: 1.2,
    repelRadius: 0.42,
    flicker: 0.28,
    breathe: 0.1,
    animationSpeed: 0.64
  },
  elastic: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#2d2d31",
    particleAccentColor: "#245cff",
    particleHighlightColor: "#f1ecff",
    particleCount: 19000,
    pointSize: 3.4,
    turbulence: 1.65,
    scatterRadius: 1.85,
    mouseForce: 1.55,
    attractRadius: 0.72,
    repelRadius: 0.88,
    flicker: 0.2,
    breathe: 0.12,
    animationSpeed: 0.9
  },
  hyperspace: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f8fbff",
    particleAccentColor: "#6ee8ff",
    particleHighlightColor: "#ffffff",
    particleCount: 22000,
    pointSize: 2.4,
    turbulence: 1.35,
    scatterRadius: 2.2,
    mouseForce: 1.1,
    attractRadius: 0.95,
    repelRadius: 1.25,
    flicker: 0.22,
    breathe: 0.14,
    animationSpeed: 1.25
  },
  access: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f7f7f2",
    particleAccentColor: "#88ecff",
    particleHighlightColor: "#ff6c9f",
    particleCount: 12000,
    pointSize: 2.2,
    turbulence: 0.85,
    scatterRadius: 0.8,
    mouseForce: 1.05,
    attractRadius: 1.15,
    repelRadius: 0.7,
    flicker: 0.1,
    breathe: 0.06,
    animationSpeed: 0.95
  },
  glitch: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f7f7f2",
    particleAccentColor: "#57eaff",
    particleHighlightColor: "#ff4f9c",
    particleCount: 12000,
    pointSize: 2.8,
    turbulence: 0.85,
    scatterRadius: 1.2,
    mouseForce: 1.25,
    attractRadius: 1.25,
    repelRadius: 0.78,
    flicker: 0.48,
    breathe: 0.04,
    surfaceDepth: 0,
    animationSpeed: 0.95
  },
  trail: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#ffffff",
    particleAccentColor: "#362cb7",
    particleHighlightColor: "#78f7ff",
    particleCount: 9000,
    pointSize: 2.8,
    turbulence: 1.05,
    scatterRadius: 1.15,
    mouseForce: 0.95,
    attractRadius: 0.982,
    repelRadius: 0.34,
    flicker: 0.12,
    breathe: 0.05,
    maskRoughness: 0,
    surfaceDepth: 0,
    animationSpeed: 0.8
  },
  fluid: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#e9f6ff",
    particleAccentColor: "#57dfff",
    particleHighlightColor: "#ff4e91",
    particleCount: 13000,
    pointSize: 4.8,
    turbulence: 1.15,
    scatterRadius: 0.84,
    mouseForce: 1.65,
    attractRadius: 1.18,
    repelRadius: 0.72,
    flicker: 0.16,
    breathe: 0.09,
    surfaceDepth: 0.55,
    animationSpeed: 0.82
  },
  fluidglass: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#e8fbff",
    particleAccentColor: "#6df4ff",
    particleHighlightColor: "#ffffff",
    particleCount: 12000,
    pointSize: 5.2,
    turbulence: 1.05,
    scatterRadius: 0.62,
    mouseForce: 1.35,
    attractRadius: 0.92,
    repelRadius: 0.66,
    flicker: 0.18,
    breathe: 0.08,
    maskRoughness: 0.04,
    surfaceDepth: 0.78,
    animationSpeed: 0.72
  },
  shadow: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f8f8f3",
    particleAccentColor: "#6f7782",
    particleHighlightColor: "#ffffff",
    particleCount: 10000,
    pointSize: 4.4,
    turbulence: 0.12,
    scatterRadius: 0.52,
    mouseForce: 1.15,
    attractRadius: 1.05,
    repelRadius: 1.15,
    flicker: 0.24,
    breathe: 0.04,
    maskRoughness: 0,
    surfaceDepth: 0.82,
    animationSpeed: 0.68
  },
  clouds: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f7f4eb",
    particleAccentColor: "#c5d0dc",
    particleHighlightColor: "#ffffff",
    particleCount: 2800,
    pointSize: 10.2,
    turbulence: 0.2,
    scatterRadius: 0.22,
    mouseForce: 0.34,
    attractRadius: 0.9,
    repelRadius: 0.36,
    flicker: 0.02,
    breathe: 0.22,
    animationSpeed: 0.55
  },
  bubbles: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#eaffff",
    particleAccentColor: "#6fe8ff",
    particleHighlightColor: "#ffffff",
    particleCount: 13000,
    pointSize: 4.9,
    turbulence: 0.55,
    scatterRadius: 1.15,
    mouseForce: 0.9,
    attractRadius: 1.2,
    repelRadius: 0.42,
    flicker: 0.12,
    breathe: 0.18,
    animationSpeed: 0.78
  },
  blossom: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#ff8fc0",
    particleAccentColor: "#67b86a",
    particleHighlightColor: "#fff5b8",
    particleCount: 11500,
    pointSize: 5.2,
    turbulence: 0.72,
    scatterRadius: 0.92,
    mouseForce: 0.64,
    attractRadius: 1.1,
    repelRadius: 0.52,
    flicker: 0.18,
    breathe: 0.12,
    animationSpeed: 0.72
  },
  gaze: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f7f2ea",
    particleAccentColor: "#4aa9ff",
    particleHighlightColor: "#11121a",
    particleCount: 9000,
    pointSize: 6.2,
    turbulence: 0.35,
    scatterRadius: 0.58,
    mouseForce: 1.35,
    attractRadius: 1.45,
    repelRadius: 0.55,
    flicker: 0.04,
    breathe: 0.08,
    animationSpeed: 0.68
  },
  vfx: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f8fbff",
    particleAccentColor: "#55eaff",
    particleHighlightColor: "#ff4b9b",
    particleCount: 12000,
    pointSize: 5.6,
    turbulence: 0.9,
    scatterRadius: 1.05,
    mouseForce: 1.55,
    attractRadius: 1.35,
    repelRadius: 0.86,
    flicker: 0.22,
    breathe: 0.04,
    animationSpeed: 0.78
  },
  ascii: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#ffb829",
    particleAccentColor: "#2e9455",
    particleHighlightColor: "#ff6b6b",
    asciiCharacters: "who3",
    particleCount: 7000,
    pointSize: 3.6,
    turbulence: 2.35,
    scatterRadius: 1.6,
    mouseForce: 2.5,
    attractRadius: 0.75,
    repelRadius: 1.24,
    flicker: 0.85,
    breathe: 0.02,
    animationSpeed: 1.15
  },
  ascii2: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f6f6f2",
    particleAccentColor: "#8ff7ff",
    particleHighlightColor: "#ff5f9e",
    asciiCharacters:
      " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    particleCount: 14000,
    pointSize: 10,
    turbulence: 0.82,
    scatterRadius: 8,
    mouseForce: 0.75,
    attractRadius: 0.65,
    repelRadius: 0.42,
    flicker: 0.58,
    breathe: 0.1,
    animationSpeed: 0.9
  },
  fancy: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f0f5df",
    particleAccentColor: "#ff3b68",
    particleHighlightColor: "#45c7dd",
    fancyVariant: "effect1",
    particleCount: 12000,
    pointSize: 7.5,
    turbulence: 0.9,
    scatterRadius: 0.72,
    mouseForce: 0.55,
    attractRadius: 0.55,
    repelRadius: 0.55,
    flicker: 0.82,
    breathe: 0.08,
    animationSpeed: 0.55
  },
  walkers: {
    ...BASE_EFFECT_SETTINGS,
    particleColor: "#f8fcff",
    particleAccentColor: "#7be0a8",
    particleHighlightColor: "#ffffff",
    particleCount: 12000,
    pointSize: 1.6,
    turbulence: 0.4,
    scatterRadius: 0.6,
    mouseForce: 0.85,
    attractRadius: 0.45,
    repelRadius: 0.5,
    flicker: 0.3,
    breathe: 0.3,
    walkerReturnSpeed: 0.32,
    walkerWander: 0.55,
    gridVisible: false,
    animationSpeed: 0.4
  }
};

const LOGO_STYLES: Array<{
  id: LogoStyle;
  label: string;
  hudLabel: string;
  detail: string;
}> = [
  { id: "dust", label: "Particles", hudLabel: "PARTICLES", detail: "white particle flow" },
  { id: "ripples", label: "Ripples", hudLabel: "RIPPLES", detail: "ring wave pulses" },
  { id: "lines", label: "Lines", hudLabel: "LINES", detail: "thin scan strokes" },
  { id: "ascii", label: "ASCII", hudLabel: "ASCII", detail: "glyph particle field" },
  { id: "ascii2", label: "ASCII 2", hudLabel: "ASCII 2", detail: "raster text filter" },
  { id: "fancy", label: "Fancy", hudLabel: "FANCY", detail: "layered SVG strokes" },
  { id: "walkers", label: "Walkers", hudLabel: "WALKERS", detail: "webcam crowd flow" },
  { id: "metal", label: "Metal", hudLabel: "METAL", detail: "extruded silver 3D" },
  { id: "mercury", label: "Mercury", hudLabel: "MERCURY", detail: "liquid chrome relief" },
  { id: "chrome", label: "Chrome", hudLabel: "CHROME", detail: "prismatic flow metal" },
  { id: "radiance", label: "Radiance", hudLabel: "RADIANCE", detail: "red beam glow" },
  { id: "dither", label: "Dither", hudLabel: "DITHER", detail: "ordered halftone" },
  { id: "bulge", label: "Bulge", hudLabel: "BULGE", detail: "refractive 3D lens" },
  { id: "gommage", label: "Gommage", hudLabel: "GOMMAGE", detail: "powder dissolve" },
  { id: "elastic", label: "Elastic", hudLabel: "ELASTIC", detail: "vertex destruction" },
  { id: "hyperspace", label: "Hyperspace", hudLabel: "HYPERSPACE", detail: "warp tunnel particles" },
  { id: "access", label: "Access", hudLabel: "ACCESS", detail: "text reveal RGB shift" },
  { id: "glitch", label: "Glitch", hudLabel: "GLITCH", detail: "RGB slice reveal" },
  { id: "trail", label: "Trail", hudLabel: "TRAIL", detail: "framebuffer text trail" },
  { id: "fluid", label: "Fluid", hudLabel: "FLUID", detail: "mouse fluid reveal" },
  { id: "fluidglass", label: "Fluid Glass", hudLabel: "GLASS", detail: "reaction glass flow" },
  { id: "shadow", label: "Shadow", hudLabel: "SHADOW", detail: "lifted SVG shadow" },
  { id: "clouds", label: "Clouds", hudLabel: "CLOUDS", detail: "smoke typing puffs" },
  { id: "bubbles", label: "Bubbles", hudLabel: "BUBBLES", detail: "rising bubble type" },
  { id: "blossom", label: "Blossom", hudLabel: "BLOSSOM", detail: "flower leaf type" },
  { id: "gaze", label: "Gaze", hudLabel: "GAZE", detail: "pupil follow type" },
  { id: "vfx", label: "VFX", hudLabel: "VFX", detail: "thru light shadow" }
];

const LOGO_STYLE_IDS = new Set<string>(LOGO_STYLES.map((style) => style.id));

function readLogoStyleFromUrl(): LogoStyle {
  if (typeof window === "undefined") {
    return "dust";
  }
  const slug = window.location.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return LOGO_STYLE_IDS.has(slug) ? (slug as LogoStyle) : "dust";
}

const FANCY_VARIANTS: Array<{
  id: FancyVariant;
  label: string;
  detail: string;
}> = [
  { id: "effect1", label: "Effect 1", detail: "looping layered strokes" },
  { id: "effect2", label: "Effect 2", detail: "CODE segmented lines" },
  { id: "effect3", label: "Effect 3", detail: "hand draw cursor" },
  { id: "effect4", label: "Effect 4", detail: "signal scan lines" }
];

const DRAW_WIDTH = 320;
const DRAW_HEIGHT = 220;
const DRAW_MIN_DISTANCE = 1.6;

type SourceMode = "markup" | "draw";
type DrawTool = "brush" | "pen" | "line" | "rect" | "ellipse";
type DrawPoint = {
  x: number;
  y: number;
};
type PenNode = {
  point: DrawPoint;
  in?: DrawPoint;
  out?: DrawPoint;
};
type BrushStroke = {
  tool: "brush";
  points: DrawPoint[];
};
type PenStroke = {
  tool: "pen";
  nodes: PenNode[];
  closed?: boolean;
};
type ShapeStroke = {
  tool: "line" | "rect" | "ellipse";
  start: DrawPoint;
  end: DrawPoint;
};
type DrawStroke = BrushStroke | PenStroke | ShapeStroke;
type PenDrag =
  | {
      type: "new-node";
      index: number;
    }
  | {
      type: "anchor" | "in" | "out";
      index: number;
    };

function copyTextWithFallback(text: string) {
  let eventCopied = false;
  const handleCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    eventCopied = true;
  };

  document.addEventListener("copy", handleCopy);
  const eventCopyCommand = document.execCommand("copy");
  document.removeEventListener("copy", handleCopy);

  if (eventCopyCommand && eventCopied) {
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard fallback failed.");
  }
}

export default function App() {
  const [logoStyle, setLogoStyle] = useState<LogoStyle>(readLogoStyleFromUrl);
  const [settingsByStyle, setSettingsByStyle] =
    useState<Record<LogoStyle, EffectSettings>>(EFFECT_SETTING_PRESETS);
  const [draftSvg, setDraftSvg] = useState(DEFAULT_SVG);
  const [draftName, setDraftName] = useState("whothree.svg");
  const [sourceMode, setSourceMode] = useState<SourceMode>("markup");
  const [drawTool, setDrawTool] = useState<DrawTool>("brush");
  const [drawFullscreen, setDrawFullscreen] = useState(false);
  const [drawStrokes, setDrawStrokes] = useState<DrawStroke[]>([]);
  const [currentBrushStroke, setCurrentBrushStroke] = useState<DrawPoint[]>([]);
  const [currentShapeStroke, setCurrentShapeStroke] = useState<ShapeStroke | null>(null);
  const [penNodes, setPenNodes] = useState<PenNode[]>([]);
  const [penPreviewPoint, setPenPreviewPoint] = useState<DrawPoint | null>(null);
  const [activeSource, setActiveSource] = useState<LogoSource>({
    kind: "paste",
    name: "whothree.svg",
    svgText: DEFAULT_SVG
  });
  const [inputError, setInputError] = useState<string | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [panelVisible, setPanelVisible] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches ? false : true
  );
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [jsonCopyStatus, setJsonCopyStatus] =
    useState<"idle" | "copied" | "selected">("idle");
  const [jsonExportText, setJsonExportText] = useState("");
  const [webglSupported, setWebglSupported] = useState(true);
  const [webgpuSupported, setWebgpuSupported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonExportRef = useRef<HTMLTextAreaElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const currentBrushStrokeRef = useRef<DrawPoint[]>([]);
  const currentShapeStrokeRef = useRef<ShapeStroke | null>(null);
  const penDragRef = useRef<PenDrag | null>(null);
  const drawCommitTimerRef = useRef<number | null>(null);
  const liveDrawSvgRef = useRef(DEFAULT_SVG);

  const settings = useMemo<ParticleSettings>(
    () => ({
      logoStyle,
      ...BASE_EFFECT_SETTINGS,
      ...EFFECT_SETTING_PRESETS[logoStyle],
      ...settingsByStyle[logoStyle]
    }),
    [logoStyle, settingsByStyle]
  );
  const preview = useMemo(() => sanitizeSvgText(draftSvg), [draftSvg]);
  const visibleDrawStrokes = useMemo(
    () => [
      ...drawStrokes,
      ...(currentBrushStroke.length > 0
        ? [{ tool: "brush" as const, points: currentBrushStroke }]
        : []),
      ...(currentShapeStroke ? [currentShapeStroke] : []),
      ...(penNodes.length >= 2 ? [{ tool: "pen" as const, nodes: penNodes }] : [])
    ],
    [currentBrushStroke, currentShapeStroke, drawStrokes, penNodes]
  );
  const drawingSvg = useMemo(() => buildDrawingSvg(visibleDrawStrokes), [visibleDrawStrokes]);
  const committedDrawingSvg = useMemo(() => buildDrawingSvg(drawStrokes), [drawStrokes]);
  const penPreviewStroke = useMemo(
    () =>
      penNodes.length > 0 && penPreviewPoint
        ? { tool: "pen" as const, nodes: [...penNodes, { point: penPreviewPoint }] }
        : null,
    [penNodes, penPreviewPoint]
  );
  const colorLabels = getColorControlLabels(settings.logoStyle);
  const typingLabels = getTypingControlLabels(settings.logoStyle);
  const activeStyle = LOGO_STYLES.find((style) => style.id === settings.logoStyle) ?? LOGO_STYLES[0];

  useEffect(() => {
    setWebglSupported(detectWebGlSupport());
    setWebgpuSupported(typeof navigator !== "undefined" && "gpu" in navigator);
  }, []);

  useEffect(() => {
    const path = logoStyle === "dust" ? "/" : `/${logoStyle}`;
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", `${path}${window.location.search}`);
    }
  }, [logoStyle]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const syncMobileDefaults = (event?: MediaQueryList | MediaQueryListEvent) => {
      const matches = event ? event.matches : media.matches;
      if (matches) {
        setPanelVisible(false);
        setModeMenuOpen(false);
      }
    };

    syncMobileDefaults();
    media.addEventListener("change", syncMobileDefaults);
    return () => media.removeEventListener("change", syncMobileDefaults);
  }, []);

  useEffect(() => {
    if (jsonCopyStatus !== "selected") {
      return;
    }

    const textarea = jsonExportRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus();
    textarea.select();
  }, [jsonCopyStatus, jsonExportText]);

  useEffect(() => {
    if (sourceMode !== "draw") {
      return;
    }

    setDraftSvg(drawingSvg);
    setDraftName(visibleDrawStrokes.length > 0 ? "Drawn SVG" : "Drawing.svg");
    setInputError(null);
  }, [drawingSvg, sourceMode, visibleDrawStrokes.length]);

  useEffect(() => {
    if (sourceMode !== "draw" || drawStrokes.length === 0) {
      return;
    }

    if (drawCommitTimerRef.current !== null) {
      window.clearTimeout(drawCommitTimerRef.current);
    }

    drawCommitTimerRef.current = window.setTimeout(() => {
      const sanitized = sanitizeSvgText(committedDrawingSvg);

      if (!sanitized.ok || sanitized.svgText === liveDrawSvgRef.current) {
        return;
      }

      try {
        sampleSvgToParticles(sanitized.svgText, Math.min(settings.particleCount, 900), 47);
        liveDrawSvgRef.current = sanitized.svgText;
        setActiveSource({
          kind: "paste",
          name: "Live drawing",
          svgText: sanitized.svgText
        });
        setInputError(null);
        setReplayNonce((value) => value + 1);
      } catch {
        // The live drawing can temporarily contain too few valid path points.
      }
    }, 220);

    return () => {
      if (drawCommitTimerRef.current !== null) {
        window.clearTimeout(drawCommitTimerRef.current);
      }
    };
  }, [committedDrawingSvg, drawStrokes.length, settings.particleCount, sourceMode]);

  const updateSetting = <Key extends keyof ParticleSettings>(
    key: Key,
    value: ParticleSettings[Key]
  ) => {
    if (key === "logoStyle") {
      setLogoStyle(value as LogoStyle);
      setIsPaused(false);
      setReplayNonce((current) => current + 1);
      return;
    }

    setSettingsByStyle((current) => ({
      ...current,
      [logoStyle]: {
        ...EFFECT_SETTING_PRESETS[logoStyle],
        ...current[logoStyle],
        [key]: value
      } as EffectSettings
    }));
  };

  const getSvgAdjustedSettings = (svgText: string) =>
    LOGO_STYLES.reduce(
      (nextSettings, style) => ({
        ...nextSettings,
        [style.id]: {
          ...EFFECT_SETTING_PRESETS[style.id],
          ...settingsByStyle[style.id],
          particleCount: getRecommendedParticleCount(
            svgText,
            EFFECT_SETTING_PRESETS[style.id].particleCount
          )
        }
      }),
      {} as Record<LogoStyle, EffectSettings>
    );

  const applySvgSource = (
    svgText: string,
    source: Pick<LogoSource, "kind" | "name">
  ) => {
    setDraftSvg(svgText);
    setDraftName(source.name || "");
    setSourceMode("markup");

    const sanitized = sanitizeSvgText(svgText);

    if (!sanitized.ok) {
      setInputError(sanitized.error);
      return;
    }

    try {
      const nextSettingsByStyle = getSvgAdjustedSettings(sanitized.svgText);
      sampleSvgToParticles(
        sanitized.svgText,
        Math.min(nextSettingsByStyle[logoStyle].particleCount, 1600),
        31
      );
      setSettingsByStyle(nextSettingsByStyle);
      setActiveSource({
        kind: source.kind,
        name: source.name || "Pasted SVG",
        svgText: sanitized.svgText
      });
      setDraftSvg(sanitized.svgText);
      setInputError(null);
      setIsPaused(false);
      setReplayNonce((value) => value + 1);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "No visible SVG paths found.");
    }
  };

  const selectDrawTool = (tool: DrawTool) => {
    setDrawTool(tool);
    setPenPreviewPoint(null);

    if (tool !== "pen") {
      penDragRef.current = null;
    }
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".svg")) {
      setInputError("Please choose an .svg file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      applySvgSource(text, { kind: "upload", name: file.name });
    };
    reader.onerror = () => {
      setInputError("The SVG file could not be read.");
    };
    reader.readAsText(file);
  };

  const handleApply = () => {
    applySvgSource(draftSvg, {
      kind: sourceMode === "markup" && draftName ? "upload" : "paste",
      name: draftName || "Pasted SVG"
    });
  };

  const handleCopyEffectJson = async () => {
    const payload = {
      version: 1,
      source: {
        kind: activeSource.kind,
        name: activeSource.name,
        svgText: activeSource.svgText
      },
      effect: settings
    };
    const jsonText = JSON.stringify(payload, null, 2);

    try {
      copyTextWithFallback(jsonText);
      setJsonExportText("");
      setJsonCopyStatus("copied");
    } catch {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API unavailable.");
        }
        await navigator.clipboard.writeText(jsonText);
        setJsonExportText("");
        setJsonCopyStatus("copied");
      } catch {
        setJsonExportText(jsonText);
        setJsonCopyStatus("selected");
      }
    }

    window.setTimeout(() => {
      setJsonCopyStatus((current) => (current === "copied" ? "idle" : current));
    }, 1400);
  };

  const handleDrawPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const point = getDrawPoint(event);

    if (isShapeTool(drawTool)) {
      const nextPointerId = event.pointerId;
      const shapeStroke: ShapeStroke = {
        tool: drawTool,
        start: point,
        end: point
      };
      activePointerId.current = nextPointerId;
      currentShapeStrokeRef.current = shapeStroke;
      event.currentTarget.setPointerCapture(nextPointerId);
      setCurrentShapeStroke(shapeStroke);
      setInputError(null);
      return;
    }

    if (drawTool === "pen") {
      const nextPointerId = event.pointerId;
      activePointerId.current = nextPointerId;
      event.currentTarget.setPointerCapture(nextPointerId);
      setPenNodes((current) => {
        const next = [...current, { point }];
        penDragRef.current = { type: "new-node", index: next.length - 1 };
        return next;
      });
      setPenPreviewPoint(null);
      setInputError(null);
      return;
    }

    activePointerId.current = event.pointerId;
    currentBrushStrokeRef.current = [point];
    event.currentTarget.setPointerCapture(event.pointerId);
    setCurrentBrushStroke([point]);
    setInputError(null);
  };

  const handleDrawPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = getDrawPoint(event);

    if (drawTool === "pen") {
      const drag = penDragRef.current;

      if (activePointerId.current === event.pointerId && drag) {
        setPenNodes((current) => updatePenDrag(current, drag, point));
        return;
      }

      if (penNodes.length > 0) {
        setPenPreviewPoint(point);
      }
      return;
    }

    if (isShapeTool(drawTool)) {
      if (activePointerId.current !== event.pointerId) {
        return;
      }

      const shapeStroke = currentShapeStrokeRef.current;

      if (!shapeStroke) {
        return;
      }

      const nextShapeStroke = {
        ...shapeStroke,
        end: point
      };
      currentShapeStrokeRef.current = nextShapeStroke;
      setCurrentShapeStroke(nextShapeStroke);
      return;
    }

    if (activePointerId.current !== event.pointerId) {
      return;
    }

    const previous = currentBrushStrokeRef.current;
    const lastPoint = previous[previous.length - 1];

    if (lastPoint && distance(lastPoint, point) < DRAW_MIN_DISTANCE) {
      return;
    }

    const nextStroke = [...previous, point];
    currentBrushStrokeRef.current = nextStroke;
    setCurrentBrushStroke(nextStroke);
  };

  const handleDrawPointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawTool === "pen") {
      if (activePointerId.current === event.pointerId) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        activePointerId.current = null;
        penDragRef.current = null;
      }
      return;
    }

    if (isShapeTool(drawTool)) {
      if (activePointerId.current !== event.pointerId) {
        return;
      }

      const shapeStroke = currentShapeStrokeRef.current;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (shapeStroke && distance(shapeStroke.start, shapeStroke.end) > 1.5) {
        setDrawStrokes((current) => [...current, shapeStroke]);
      }

      currentShapeStrokeRef.current = null;
      activePointerId.current = null;
      setCurrentShapeStroke(null);
      return;
    }

    if (activePointerId.current !== event.pointerId) {
      return;
    }

    const stroke = currentBrushStrokeRef.current;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (stroke.length > 0) {
      setDrawStrokes((current) => [...current, { tool: "brush", points: stroke }]);
    }

    currentBrushStrokeRef.current = [];
    activePointerId.current = null;
    setCurrentBrushStroke([]);
  };

  const finishPenPath = () => {
    if (penNodes.length < 2) {
      return;
    }

    setDrawStrokes((current) => [...current, { tool: "pen", nodes: penNodes }]);
    setPenNodes([]);
    setPenPreviewPoint(null);
  };

  const closePenPath = () => {
    if (penNodes.length < 3) {
      return;
    }

    setDrawStrokes((current) => [
      ...current,
      { tool: "pen", nodes: penNodes, closed: true }
    ]);
    setPenNodes([]);
    setPenPreviewPoint(null);
  };

  const undoPenPoint = () => {
    setPenNodes((current) => current.slice(0, -1));
    setPenPreviewPoint(null);
  };

  const clearDrawing = () => {
    currentBrushStrokeRef.current = [];
    currentShapeStrokeRef.current = null;
    activePointerId.current = null;
    penDragRef.current = null;
    if (drawCommitTimerRef.current !== null) {
      window.clearTimeout(drawCommitTimerRef.current);
    }
    setCurrentBrushStroke([]);
    setCurrentShapeStroke(null);
    setPenNodes([]);
    setPenPreviewPoint(null);
    setDrawStrokes([]);
    setSourceMode("draw");
  };

  const startPenControlDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    drag: PenDrag
  ) => {
    event.stopPropagation();
    activePointerId.current = event.pointerId;
    penDragRef.current = drag;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const renderStatus =
    settings.renderMode === "webgpu-tsl"
      ? webgpuSupported
        ? "TSL preview"
        : "WebGL fallback"
      : "WebGL GLSL";
  const mobileUiOpen = panelVisible || modeMenuOpen;

  const closeMobileSheets = () => {
    setPanelVisible(false);
    setModeMenuOpen(false);
  };

  const openMobileEffects = () => {
    setModeMenuOpen(true);
    setPanelVisible(false);
  };

  const openMobileControls = () => {
    setPanelVisible(true);
    setModeMenuOpen(false);
  };

  const selectLogoStyle = (style: LogoStyle) => {
    updateSetting("logoStyle", style);
    setModeMenuOpen(false);
  };

  return (
    <div
      className={`app-shell ${panelVisible ? "" : "panel-hidden"} ${
        mobileUiOpen ? "mobile-ui-open" : ""
      } ${modeMenuOpen ? "mobile-effects-open" : ""}`}
    >
      <button
        type="button"
        className="mobile-backdrop"
        aria-label="Close panel"
        onClick={closeMobileSheets}
      />
      <aside className="control-panel" aria-label="Particle logo controls">
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-handle" aria-hidden="true" />
          <div className="mobile-sheet-title">
            <strong>Controls</strong>
            <small>{activeStyle.hudLabel}</small>
          </div>
          <button
            type="button"
            className="mobile-sheet-close"
            aria-label="Close controls"
            onClick={() => setPanelVisible(false)}
          >
            <X size={18} />
          </button>
        </div>
        <header className="app-header">
          <div className="app-mark">
            <Sparkles size={18} strokeWidth={1.7} />
          </div>
          <div>
            <h1>Particle SVG Logo</h1>
            <p>{activeSource.name || "Untitled SVG"}</p>
          </div>
        </header>

        <section className="panel-section source-section">
          <div className="section-title">
            <FileCode2 size={14} />
            <span>SVG source</span>
          </div>

          <div className="source-tabs" role="tablist" aria-label="SVG input mode">
            <button
              className={`source-tab ${sourceMode === "markup" ? "active" : ""}`}
              type="button"
              onClick={() => setSourceMode("markup")}
            >
              <FileCode2 size={13} />
              Markup
            </button>
            <button
              className={`source-tab ${sourceMode === "draw" ? "active" : ""}`}
              type="button"
              onClick={() => setSourceMode("draw")}
            >
              <PenLine size={13} />
              Draw
            </button>
          </div>

          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".svg,image/svg+xml"
            onChange={handleUpload}
          />
          <div className="source-actions">
            <button className="button secondary" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} />
              Upload
            </button>
            <button className="button primary" onClick={handleApply} disabled={!preview.ok}>
              <Play size={14} />
              Apply
            </button>
            <button
              className="icon-button"
              aria-label="Replay particle animation"
              title="Replay"
              onClick={() => setReplayNonce((value) => value + 1)}
            >
              <RefreshCcw size={14} />
            </button>
          </div>

          {sourceMode === "draw" && (
            <div className="draw-panel">
              <div className="tool-tabs" role="toolbar" aria-label="Drawing tools">
                <button
                  className={`tool-tab ${drawTool === "brush" ? "active" : ""}`}
                  type="button"
                  onClick={() => selectDrawTool("brush")}
                >
                  <Brush size={15} />
                  Brush
                </button>
                <button
                  className={`tool-tab ${drawTool === "pen" ? "active" : ""}`}
                  type="button"
                  onClick={() => selectDrawTool("pen")}
                >
                  <PenLine size={15} />
                  Pen
                </button>
                <button
                  className={`tool-tab ${drawTool === "line" ? "active" : ""}`}
                  type="button"
                  onClick={() => selectDrawTool("line")}
                >
                  <Minus size={15} />
                  Line
                </button>
                <button
                  className={`tool-tab ${drawTool === "rect" ? "active" : ""}`}
                  type="button"
                  onClick={() => selectDrawTool("rect")}
                >
                  <Square size={15} />
                  Rect
                </button>
                <button
                  className={`tool-tab ${drawTool === "ellipse" ? "active" : ""}`}
                  type="button"
                  onClick={() => selectDrawTool("ellipse")}
                >
                  <Circle size={15} />
                  Oval
                </button>
              </div>
              <svg
                className={`draw-pad ${drawTool === "pen" ? "pen-mode" : ""}`}
                viewBox={`0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}`}
                role="img"
                aria-label="Draw SVG paths"
                onPointerDown={handleDrawPointerDown}
                onPointerMove={handleDrawPointerMove}
                onPointerUp={handleDrawPointerEnd}
                onPointerCancel={handleDrawPointerEnd}
              >
                <defs>
                  <pattern id="draw-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.08)" />
                  </pattern>
                </defs>
                <rect width={DRAW_WIDTH} height={DRAW_HEIGHT} fill="url(#draw-grid)" />
                <rect
                  x="1"
                  y="1"
                  width={DRAW_WIDTH - 2}
                  height={DRAW_HEIGHT - 2}
                  fill="none"
                  stroke="rgba(126,192,255,0.22)"
                />
                {visibleDrawStrokes.map((stroke, index) => (
                  <path
                    key={`${index}-${getStrokePointCount(stroke)}-${stroke.tool}-${isStrokeClosed(stroke) ? "closed" : "open"}`}
                    d={pathFromStroke(stroke)}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {penPreviewStroke && (
                  <path
                    className="pen-preview-path"
                    d={pathFromStroke(penPreviewStroke)}
                    fill="none"
                    stroke="#7ec0ff"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {drawTool === "pen" &&
                  penNodes.map((node, index) => (
                    <g key={`${index}-${node.point.x}-${node.point.y}`}>
                      {node.in && (
                        <>
                          <line
                            className="pen-handle-line"
                            x1={node.point.x}
                            y1={node.point.y}
                            x2={node.in.x}
                            y2={node.in.y}
                          />
                          <circle
                            className="pen-handle"
                            cx={node.in.x}
                            cy={node.in.y}
                            r="3.4"
                            onPointerDown={(event) =>
                              startPenControlDrag(event, { type: "in", index })
                            }
                          />
                        </>
                      )}
                      {node.out && (
                        <>
                          <line
                            className="pen-handle-line"
                            x1={node.point.x}
                            y1={node.point.y}
                            x2={node.out.x}
                            y2={node.out.y}
                          />
                          <circle
                            className="pen-handle"
                            cx={node.out.x}
                            cy={node.out.y}
                            r="3.4"
                            onPointerDown={(event) =>
                              startPenControlDrag(event, { type: "out", index })
                            }
                          />
                        </>
                      )}
                      <circle
                        className="pen-anchor"
                        cx={node.point.x}
                        cy={node.point.y}
                        r="4.2"
                        onPointerDown={(event) =>
                          startPenControlDrag(event, { type: "anchor", index })
                        }
                      />
                    </g>
                  ))}
              </svg>

              <div className="draw-actions">
                <span>
                  {drawStrokes.length} paths
                  {drawTool === "pen" && penNodes.length > 0
                    ? ` · ${penNodes.length} anchors`
                    : ""}
                </span>
                <div className="draw-action-buttons">
                  {drawTool === "pen" && (
                    <>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={undoPenPoint}
                        disabled={penNodes.length === 0}
                      >
                        <Undo2 size={15} />
                        Undo
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={finishPenPath}
                        disabled={penNodes.length < 2}
                      >
                        <Check size={15} />
                        Finish
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={closePenPath}
                        disabled={penNodes.length < 3}
                      >
                        Close
                      </button>
                    </>
                  )}
                  <button
                    className="button secondary"
                    type="button"
                    onClick={clearDrawing}
                    disabled={visibleDrawStrokes.length === 0 && penNodes.length === 0}
                  >
                    <Trash2 size={15} />
                    Clear
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setDrawFullscreen(true)}
                  >
                    <Expand size={15} />
                    Expand
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className={`preview-box ${preview.ok ? "" : "has-error"}`}>
            {preview.ok ? (
              <div
                className="svg-preview"
                dangerouslySetInnerHTML={{ __html: preview.svgText }}
              />
            ) : (
              <span>{preview.error}</span>
            )}
          </div>

          <label className="textarea-label" htmlFor="svg-source">
            SVG markup
          </label>
          <textarea
            id="svg-source"
            className="svg-textarea"
            spellCheck={false}
            value={draftSvg}
            onChange={(event) => {
              setSourceMode("markup");
              setDraftSvg(event.target.value);
              setDraftName("");
              setInputError(null);
            }}
          />

          {inputError && <div className="error-line">{inputError}</div>}
        </section>

        <section className="panel-section controls-section">
          <div className="section-title">
            <SlidersHorizontal size={16} />
            <span>
              {settings.logoStyle === "metal"
                ? "3D metal controls"
                : settings.logoStyle === "mercury"
                ? "Liquid metal controls"
                : settings.logoStyle === "chrome"
                ? "Chrome shader controls"
                : settings.logoStyle === "bulge"
                ? "Bulge lens controls"
                : settings.logoStyle === "gommage"
                ? "Gommage controls"
                : settings.logoStyle === "elastic"
                ? "Elastic vertex controls"
                : settings.logoStyle === "hyperspace"
                ? "Hyperspace controls"
                : settings.logoStyle === "access"
                ? "Accessible text controls"
                : settings.logoStyle === "glitch"
                ? "Glitch controls"
                : settings.logoStyle === "trail"
                ? "Trail framebuffer controls"
                : settings.logoStyle === "fluid"
                ? "Fluid reveal controls"
                : settings.logoStyle === "fluidglass"
                ? "Fluid glass controls"
                : settings.logoStyle === "shadow"
                ? "Shadow lift controls"
                : typingLabels
                ? typingLabels.title
                : settings.logoStyle === "vfx"
                ? "VFX texture controls"
                : settings.logoStyle === "ascii2"
                ? "ASCII raster controls"
                : settings.logoStyle === "fancy"
                ? "Fancy stroke controls"
                : settings.logoStyle === "walkers"
                ? "Webcam crowd controls"
                : "Shader controls"}
            </span>
          </div>

          <div className="color-grid" aria-label={colorLabels.ariaLabel}>
            <ColorControl
              label={colorLabels.primary}
              value={settings.particleColor}
              onChange={(value) => updateSetting("particleColor", value)}
            />
            <ColorControl
              label={colorLabels.accent}
              value={settings.particleAccentColor}
              onChange={(value) => updateSetting("particleAccentColor", value)}
            />
            <ColorControl
              label={colorLabels.highlight}
              value={settings.particleHighlightColor}
              onChange={(value) => updateSetting("particleHighlightColor", value)}
            />
          </div>

          {(settings.logoStyle === "ascii" || settings.logoStyle === "ascii2") && (
            <label className="ascii-input-row">
              <span>
                <strong>
                  {settings.logoStyle === "ascii2" ? "ASCII chars" : "Glyph chars"}
                </strong>
                <small>
                  {settings.logoStyle === "ascii2"
                    ? "Used by raster filter"
                    : "Used by ASCII particles"}
                </small>
              </span>
              <input
                aria-label="ASCII characters"
                spellCheck={false}
                maxLength={settings.logoStyle === "ascii2" ? 96 : 64}
                value={settings.asciiCharacters}
                onChange={(event) => updateSetting("asciiCharacters", event.target.value)}
              />
            </label>
          )}

          {settings.logoStyle === "fancy" && (
            <label className="variant-select-row">
              <span>
                <strong>Variant</strong>
                <small>
                  {FANCY_VARIANTS.find((variant) => variant.id === settings.fancyVariant)
                    ?.detail ?? "stroke animation"}
                </small>
              </span>
              <select
                value={settings.fancyVariant}
                onChange={(event) =>
                  updateSetting("fancyVariant", event.target.value as FancyVariant)
                }
              >
                {FANCY_VARIANTS.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isSurfaceLogoStyle(settings.logoStyle) && (
            <SliderControl
              label="SVG roughness"
              value={settings.maskRoughness}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => updateSetting("maskRoughness", value)}
            />
          )}

          {settings.logoStyle === "metal" ? (
            <>
              <SliderControl
                label="Extrude depth"
                value={settings.scatterRadius}
                min={0.2}
                max={1.8}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Bevel radius"
                value={settings.pointSize}
                min={1.2}
                max={8}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Roughness"
                value={settings.turbulence}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Reflection"
                value={settings.mouseForce}
                min={0}
                max={1.4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Clearcoat"
                value={settings.attractRadius}
                min={0}
                max={1.2}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Coat blur"
                value={settings.repelRadius}
                min={0.08}
                max={1}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Edge glow"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Float"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Motion speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "chrome" ? (
            <>
              <SliderControl
                label="Scale"
                value={settings.pointSize}
                min={1.2}
                max={8}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Roughness"
                value={settings.turbulence}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Specular"
                value={settings.mouseForce}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Fresnel"
                value={settings.attractRadius}
                min={0}
                max={1.6}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Flow speed"
                value={settings.animationSpeed}
                min={0.1}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
              <SliderControl
                label="Distortion"
                value={settings.scatterRadius}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Dispersion"
                value={settings.repelRadius}
                min={0}
                max={1.4}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Iridescence"
                value={settings.flicker}
                min={0}
                max={1.4}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Brush angle"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
            </>
          ) : settings.logoStyle === "mercury" ? (
            <>
              <SliderControl
                label="Foil scale"
                value={settings.pointSize}
                min={1.2}
                max={12}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Melt flow"
                value={settings.turbulence}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Swirl force"
                value={settings.mouseForce}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Relief depth"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Fold contrast"
                value={settings.scatterRadius}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Edge emboss"
                value={settings.attractRadius}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Contour lines"
                value={settings.repelRadius}
                min={0}
                max={2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Film grain"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Pulse"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Flow speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "bulge" ? (
            <>
              <SliderControl
                label="Lens scale"
                value={settings.pointSize}
                min={1.2}
                max={10}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Refraction"
                value={settings.mouseForce}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Surface flow"
                value={settings.turbulence}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Glass depth"
                value={settings.scatterRadius}
                min={0.1}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Surface depth"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Follow"
                value={settings.attractRadius}
                min={0.45}
                max={3.2}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Edge prism"
                value={settings.repelRadius}
                min={0.12}
                max={1.8}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Grain"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Pulse"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "gommage" ? (
            <>
              <SliderControl
                label="Noise scale"
                value={settings.pointSize}
                min={1.2}
                max={10}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Dissolve"
                value={settings.mouseForce}
                min={0}
                max={1.8}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Powder noise"
                value={settings.turbulence}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Dust trail"
                value={settings.scatterRadius}
                min={0.1}
                max={3.2}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Brush width"
                value={settings.attractRadius}
                min={0.35}
                max={3.2}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Ash edge"
                value={settings.repelRadius}
                min={0.08}
                max={1.8}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Grain"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Afterglow"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "elastic" ? (
            <>
              <SliderControl
                label="Vertex size"
                value={settings.pointSize}
                min={1.2}
                max={10}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Explode amp"
                value={settings.mouseForce}
                min={0}
                max={3.2}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Noise amp"
                value={settings.turbulence}
                min={0}
                max={3.2}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Fragment spread"
                value={settings.scatterRadius}
                min={0.2}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Spring"
                value={settings.attractRadius}
                min={0.2}
                max={2.6}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Friction"
                value={settings.repelRadius}
                min={0.08}
                max={1.8}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Emissive boost"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Recoil"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "hyperspace" ? (
            <>
              <SliderControl
                label="Particle density"
                value={settings.particleCount}
                min={4000}
                max={30000}
                step={1000}
                format={(value) => `${Math.round(value / 1000)}k`}
                onChange={(value) => updateSetting("particleCount", value)}
              />
              <SliderControl
                label="Star size"
                value={settings.pointSize}
                min={0.8}
                max={7}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Tunnel depth"
                value={settings.scatterRadius}
                min={0.4}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Warp noise"
                value={settings.turbulence}
                min={0}
                max={3.5}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Mouse bend"
                value={settings.mouseForce}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Focus radius"
                value={settings.attractRadius}
                min={0.25}
                max={2.6}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Streak length"
                value={settings.repelRadius}
                min={0.2}
                max={2.4}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Spark flicker"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Pulse"
                value={settings.breathe}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Warp speed"
                value={settings.animationSpeed}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "access" ? (
            <>
              <SliderControl
                label="Reveal softness"
                value={settings.pointSize}
                min={0.6}
                max={7}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Wave amount"
                value={settings.turbulence}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="RGB split"
                value={settings.repelRadius}
                min={0}
                max={2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Pointer velocity"
                value={settings.mouseForce}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Tracking"
                value={settings.attractRadius}
                min={0.3}
                max={2.6}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Line offset"
                value={settings.scatterRadius}
                min={0}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Film grain"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Breath"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Reveal speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "glitch" ? (
            <>
              <SliderControl
                label="Slice width"
                value={settings.pointSize}
                min={0.6}
                max={8}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Signal noise"
                value={settings.turbulence}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="RGB split"
                value={settings.repelRadius}
                min={0}
                max={2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Pointer tear"
                value={settings.mouseForce}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Tracking"
                value={settings.attractRadius}
                min={0.3}
                max={2.6}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Block density"
                value={settings.scatterRadius}
                min={0}
                max={2.8}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Glitch rate"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Surface depth"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Scan pulse"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Glitch speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "fluid" ? (
            <>
              <SliderControl
                label="Fluid radius"
                value={settings.pointSize}
                min={1.2}
                max={12}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Diffusion"
                value={settings.turbulence}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Trail force"
                value={settings.mouseForce}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Reveal reach"
                value={settings.attractRadius}
                min={0.25}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Flood width"
                value={settings.repelRadius}
                min={0}
                max={2.2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Wire mix"
                value={settings.scatterRadius}
                min={0}
                max={2.6}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Surface depth"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Film grain"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="CRT pulse"
                value={settings.breathe}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Reveal speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "fluidglass" ? (
            <>
              <SliderControl
                label="Cell scale"
                value={settings.pointSize}
                min={1.2}
                max={12}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Diffusion"
                value={settings.turbulence}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Refraction"
                value={settings.mouseForce}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Reaction feed"
                value={settings.scatterRadius}
                min={0}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Focus radius"
                value={settings.attractRadius}
                min={0.25}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Caustic edge"
                value={settings.repelRadius}
                min={0}
                max={2.2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Surface depth"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Sparkle"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Pulse"
                value={settings.breathe}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Flow speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "shadow" ? (
            <>
              <SliderControl
                label="Lift height"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Lift radius"
                value={settings.attractRadius}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Bend strength"
                value={settings.mouseForce}
                min={0}
                max={3.5}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Shadow offset"
                value={settings.scatterRadius}
                min={0}
                max={2.6}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Shadow softness"
                value={settings.repelRadius}
                min={0.08}
                max={2.2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Paper texture"
                value={settings.turbulence}
                min={0}
                max={2.5}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Shadow density"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Float"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Ease speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : typingLabels ? (
            <>
              <SliderControl
                label={typingLabels.size}
                value={settings.pointSize}
                min={1}
                max={10}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label={typingLabels.motion}
                value={settings.turbulence}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label={typingLabels.spread}
                value={settings.scatterRadius}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label={typingLabels.cursor}
                value={settings.mouseForce}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label={typingLabels.focus}
                value={settings.attractRadius}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label={typingLabels.detail}
                value={settings.repelRadius}
                min={0}
                max={2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label={typingLabels.variance}
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label={typingLabels.pulse}
                value={settings.breathe}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label={typingLabels.speed}
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "trail" ? (
            <>
              <SliderControl
                label="Source weight"
                value={settings.pointSize}
                min={0.8}
                max={8}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Noise factor"
                value={settings.turbulence}
                min={0.1}
                max={5}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Trail length"
                value={settings.scatterRadius}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Mouse drag"
                value={settings.mouseForce}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="RGB persist"
                value={settings.attractRadius}
                min={0.82}
                max={0.996}
                step={0.002}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Warp scale"
                value={settings.repelRadius}
                min={0}
                max={1.4}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Alpha decay"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Source pulse"
                value={settings.breathe}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Flow speed"
                value={settings.animationSpeed}
                min={0.2}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "ascii2" ? (
            <>
              <SliderControl
                label="Cell size"
                value={settings.pointSize}
                min={5}
                max={18}
                step={0.5}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Logo scale"
                value={settings.scatterRadius}
                min={4}
                max={13}
                step={0.1}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Wave amount"
                value={settings.turbulence}
                min={0}
                max={1.8}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Mouse tilt"
                value={settings.mouseForce}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Hue drift"
                value={settings.attractRadius}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="RGB split"
                value={settings.repelRadius}
                min={0}
                max={1.2}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Contrast"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Wave pulse"
                value={settings.breathe}
                min={0}
                max={0.4}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Speed"
                value={settings.animationSpeed}
                min={0.15}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "fancy" ? (
            <>
              <SliderControl
                label="Stroke width"
                value={settings.pointSize}
                min={1}
                max={16}
                step={0.25}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Path stagger"
                value={settings.scatterRadius}
                min={0.05}
                max={1.8}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Layer delay"
                value={settings.attractRadius}
                min={0.05}
                max={1.4}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Bounce"
                value={settings.turbulence}
                min={0}
                max={1.8}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Layer spread"
                value={settings.repelRadius}
                min={0}
                max={1.4}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Hover speed"
                value={settings.mouseForce}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Underlayer fade"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Float"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Draw speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "vfx" ? (
            <>
              <SliderControl
                label="Light size"
                value={settings.pointSize}
                min={1.2}
                max={12}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Chromatic edge"
                value={settings.mouseForce}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Ray jitter"
                value={settings.turbulence}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Shadow reach"
                value={settings.scatterRadius}
                min={0}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Mouse lag"
                value={settings.attractRadius}
                min={0.35}
                max={3}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Shadow density"
                value={settings.repelRadius}
                min={0.12}
                max={1.8}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Surface depth"
                value={settings.surfaceDepth}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("surfaceDepth", value)}
              />
              <SliderControl
                label="Grain"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Light pulse"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : settings.logoStyle === "walkers" ? (
            <>
              <SliderControl
                label="Crowd"
                value={settings.particleCount}
                min={2000}
                max={24000}
                step={1000}
                format={(value) => `${Math.round(value / 1000)}k`}
                onChange={(value) => updateSetting("particleCount", value)}
              />
              <SliderControl
                label="Figure size"
                value={settings.pointSize}
                min={0.8}
                max={3.5}
                step={0.1}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Push force"
                value={settings.mouseForce}
                min={0.2}
                max={2.5}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Hand reach"
                value={settings.repelRadius}
                min={0.15}
                max={1}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Return speed"
                value={settings.walkerReturnSpeed}
                min={0}
                max={1}
                step={0.02}
                onChange={(value) => updateSetting("walkerReturnSpeed", value)}
              />
              <SliderControl
                label="Wander"
                value={settings.walkerWander}
                min={0}
                max={1}
                step={0.02}
                onChange={(value) => updateSetting("walkerWander", value)}
              />
              <SliderControl
                label="Messiness"
                value={settings.turbulence}
                min={0}
                max={1}
                step={0.02}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Walk cadence"
                value={settings.animationSpeed}
                min={0.15}
                max={1.2}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          ) : (
            <>
              <SliderControl
                label="Density"
                value={settings.particleCount}
                min={2000}
                max={30000}
                step={1000}
                format={(value) => `${Math.round(value / 1000)}k`}
                onChange={(value) => updateSetting("particleCount", value)}
              />
              <SliderControl
                label="Point size"
                value={settings.pointSize}
                min={1.2}
                max={13}
                step={0.2}
                onChange={(value) => updateSetting("pointSize", value)}
              />
              <SliderControl
                label="Flow noise"
                value={settings.turbulence}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("turbulence", value)}
              />
              <SliderControl
                label="Scatter"
                value={settings.scatterRadius}
                min={0.1}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("scatterRadius", value)}
              />
              <SliderControl
                label="Magnetic field"
                value={settings.mouseForce}
                min={0}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("mouseForce", value)}
              />
              <SliderControl
                label="Attract radius"
                value={settings.attractRadius}
                min={0.45}
                max={4}
                step={0.05}
                onChange={(value) => updateSetting("attractRadius", value)}
              />
              <SliderControl
                label="Repel radius"
                value={settings.repelRadius}
                min={0.12}
                max={1.8}
                step={0.02}
                onChange={(value) => updateSetting("repelRadius", value)}
              />
              <SliderControl
                label="Flicker"
                value={settings.flicker}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => updateSetting("flicker", value)}
              />
              <SliderControl
                label="Breathe"
                value={settings.breathe}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(value) => updateSetting("breathe", value)}
              />
              <SliderControl
                label="Speed"
                value={settings.animationSpeed}
                min={0.25}
                max={2.4}
                step={0.05}
                onChange={(value) => updateSetting("animationSpeed", value)}
              />
            </>
          )}

          <div className="control-pair">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.gridVisible}
                onChange={(event) => updateSetting("gridVisible", event.target.checked)}
              />
              <Grid3X3 size={16} />
              Grid
            </label>

            <label className="select-row">
              <Cpu size={16} />
              <select
                value={settings.renderMode}
                onChange={(event) =>
                  updateSetting("renderMode", event.target.value as RenderMode)
                }
              >
                <option value="webgl">WebGL GLSL</option>
                <option value="webgpu-tsl">WebGPU TSL</option>
              </select>
            </label>
          </div>

          <button
            className={`json-copy-button ${jsonCopyStatus !== "idle" ? `is-${jsonCopyStatus}` : ""}`}
            type="button"
            onClick={handleCopyEffectJson}
          >
            {jsonCopyStatus === "copied" ? <Check size={15} /> : <Clipboard size={15} />}
            <span>
              {jsonCopyStatus === "copied"
                ? "Copied JSON"
                : jsonCopyStatus === "selected"
                ? "JSON selected"
                : "Copy JSON"}
            </span>
            <small>{activeStyle.hudLabel} scene preset</small>
          </button>

          {jsonExportText && (
            <textarea
              ref={jsonExportRef}
              className="json-export-area"
              readOnly
              spellCheck={false}
              value={jsonExportText}
              aria-label="Exported effect JSON"
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </section>
      </aside>

      <main className="stage" aria-label="Particle logo preview">
        <ParticleLogoScene
          svgText={activeSource.svgText}
          settings={settings}
          replayNonce={replayNonce}
          paused={isPaused}
          webglSupported={webglSupported}
          webgpuSupported={webgpuSupported}
        />

        <div className="stage-hud stage-hud-top stage-hud-desktop" aria-label="Shader workspace navigation">
          <div className="hud-brand">SVG SHADER LAB</div>
          <div className="shader-mode-picker">
            <button
              className={`shader-mode-trigger active style-${activeStyle.id}`}
              type="button"
              aria-expanded={modeMenuOpen}
              aria-haspopup="listbox"
              onClick={() => setModeMenuOpen((value) => !value)}
            >
              <span className="style-swatch" aria-hidden="true" />
              <span className="shader-mode-current">
                <strong>{activeStyle.hudLabel}</strong>
                <small>{activeStyle.detail}</small>
              </span>
              <span className="shader-mode-caret" aria-hidden="true">
                {modeMenuOpen ? "CLOSE" : "OPEN"}
              </span>
            </button>
            {modeMenuOpen && (
              <div className="shader-mode-menu" role="listbox" aria-label="Shader modes">
                {LOGO_STYLES.map((style) => (
                  <button
                    key={style.id}
                    className={`style-card style-${style.id} ${
                      settings.logoStyle === style.id ? "active" : ""
                    }`}
                    type="button"
                    role="option"
                    aria-selected={settings.logoStyle === style.id}
                    onClick={() => selectLogoStyle(style.id)}
                  >
                    <span className="style-swatch" aria-hidden="true" />
                    <span>
                      <strong>{style.hudLabel}</strong>
                      <small>{style.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="hud-link"
            type="button"
            onClick={() => setPanelVisible((value) => !value)}
          >
            {panelVisible ? "HIDE" : "PROPERTIES"}
          </button>
        </div>

        <div className="stage-hud stage-hud-bottom stage-hud-desktop" aria-label="Shader playback controls">
          <div className="hud-playback">
            <button type="button" onClick={() => setIsPaused((value) => !value)}>
              {isPaused ? "PLAY" : "PAUSE"}
            </button>
            <span aria-hidden="true">|</span>
            <button
              type="button"
              onClick={() => {
                setIsPaused(false);
                setReplayNonce((value) => value + 1);
              }}
            >
              REPLAY
            </button>
          </div>
            <div className="hud-readout">
              <span>{renderStatus}</span>
            <span>
              {settings.logoStyle === "ascii"
                ? "ASCII PARTICLE FIELD"
                : settings.logoStyle === "ascii2"
                ? "ASCII RASTER FILTER"
                : settings.logoStyle === "fancy"
                ? "FANCY SVG LETTER STROKES"
                : settings.logoStyle === "chrome"
                ? "3D METAL SHADER"
                : settings.logoStyle === "mercury"
                ? "LIQUID CHROME RELIEF"
                : settings.logoStyle === "radiance"
                ? "RED BEAM SHADER"
                : settings.logoStyle === "dither"
                ? "ORDERED DITHER SHADER"
                : settings.logoStyle === "bulge"
                ? "BULGE LENS SHADER"
                : settings.logoStyle === "gommage"
                ? "GOMMAGE DISSOLVE"
                : settings.logoStyle === "elastic"
                ? "ELASTIC VERTEX FIELD"
                : settings.logoStyle === "hyperspace"
                ? "HYPERSPACE PARTICLE TUNNEL"
                : settings.logoStyle === "access"
                ? "ACCESSIBLE WEBGL TEXT"
                : settings.logoStyle === "glitch"
                ? "GLITCH RGB SLICES"
                : settings.logoStyle === "trail"
                ? "TEXT TRAIL FEEDBACK"
                : settings.logoStyle === "fluid"
                ? "FLUID CRT REVEAL"
                : settings.logoStyle === "fluidglass"
                ? "REACTION GLASS FLOW"
                : settings.logoStyle === "shadow"
                ? "LIFTED SHADOW PLANE"
                : settings.logoStyle === "clouds"
                ? "SMOKE TYPING PUFFS"
                : settings.logoStyle === "bubbles"
                ? "BUBBLE TYPING FIELD"
                : settings.logoStyle === "blossom"
                ? "BLOSSOM TYPING FIELD"
                : settings.logoStyle === "gaze"
                ? "GAZE TYPING FIELD"
                : settings.logoStyle === "vfx"
                ? "VFX THRU SHADOW"
                : settings.logoStyle === "walkers"
                ? "WEBCAM CROWD FLOW"
                : isSurfaceLogoStyle(settings.logoStyle)
                ? "SVG MASK SHADER"
                : `${settings.particleCount.toLocaleString()} PARTICLES`}
            </span>
              <span>{activeSource.name || "UNTITLED SVG"}</span>
            </div>
          <button
            className="hud-upload"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload SVG
          </button>
        </div>

        <button
          type="button"
          className="mobile-effect-chip"
          aria-expanded={modeMenuOpen}
          onClick={() => (modeMenuOpen ? closeMobileSheets() : openMobileEffects())}
        >
          <span className={`style-swatch style-${activeStyle.id}`} aria-hidden="true" />
          <span className="mobile-effect-chip-copy">
            <strong>{activeStyle.hudLabel}</strong>
            <small>{activeStyle.detail}</small>
          </span>
        </button>
      </main>

      <section
        className={`mobile-effects-sheet ${modeMenuOpen ? "open" : ""}`}
        aria-label="Shader effects"
        aria-hidden={!modeMenuOpen}
      >
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-handle" aria-hidden="true" />
          <div className="mobile-sheet-title">
            <strong>Effects</strong>
            <small>{LOGO_STYLES.length} modes</small>
          </div>
          <button
            type="button"
            className="mobile-sheet-close"
            aria-label="Close effects"
            onClick={() => setModeMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="shader-mode-menu mobile-mode-grid" role="listbox" aria-label="Shader modes">
          {LOGO_STYLES.map((style) => (
            <button
              key={`mobile-${style.id}`}
              className={`style-card style-${style.id} ${
                settings.logoStyle === style.id ? "active" : ""
              }`}
              type="button"
              role="option"
              aria-selected={settings.logoStyle === style.id}
              onClick={() => selectLogoStyle(style.id)}
            >
              <span className="style-swatch" aria-hidden="true" />
              <span>
                <strong>{style.hudLabel}</strong>
                <small>{style.detail}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <nav className="mobile-dock" aria-label="Mobile controls">
        <button
          type="button"
          className={`mobile-dock-button ${modeMenuOpen ? "active" : ""}`}
          aria-expanded={modeMenuOpen}
          onClick={() => (modeMenuOpen ? closeMobileSheets() : openMobileEffects())}
        >
          <Layers size={18} />
          <span>Effects</span>
        </button>
        <button
          type="button"
          className={`mobile-dock-button ${panelVisible ? "active" : ""}`}
          aria-expanded={panelVisible}
          onClick={() => (panelVisible ? closeMobileSheets() : openMobileControls())}
        >
          <SlidersHorizontal size={18} />
          <span>Tune</span>
        </button>
        <button
          type="button"
          className="mobile-dock-button"
          aria-label={isPaused ? "Play animation" : "Pause animation"}
          onClick={() => setIsPaused((value) => !value)}
        >
          {isPaused ? <Play size={18} /> : <Pause size={18} />}
          <span>{isPaused ? "Play" : "Pause"}</span>
        </button>
        <button
          type="button"
          className="mobile-dock-button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={18} />
          <span>SVG</span>
        </button>
      </nav>

      {sourceMode === "draw" && drawFullscreen && (
        <div className="draw-workspace" role="dialog" aria-label="Expanded SVG drawing canvas">
          <div className="draw-workspace-toolbar">
            <div className="draw-workspace-title">
              <PenLine size={17} />
              <span>SVG canvas</span>
            </div>
            <div className="tool-tabs workspace-tools" role="toolbar" aria-label="Drawing tools">
              <button
                className={`tool-tab ${drawTool === "brush" ? "active" : ""}`}
                type="button"
                onClick={() => selectDrawTool("brush")}
              >
                <Brush size={15} />
                Brush
              </button>
              <button
                className={`tool-tab ${drawTool === "pen" ? "active" : ""}`}
                type="button"
                onClick={() => selectDrawTool("pen")}
              >
                <PenLine size={15} />
                Pen
              </button>
              <button
                className={`tool-tab ${drawTool === "line" ? "active" : ""}`}
                type="button"
                onClick={() => selectDrawTool("line")}
              >
                <Minus size={15} />
                Line
              </button>
              <button
                className={`tool-tab ${drawTool === "rect" ? "active" : ""}`}
                type="button"
                onClick={() => selectDrawTool("rect")}
              >
                <Square size={15} />
                Rect
              </button>
              <button
                className={`tool-tab ${drawTool === "ellipse" ? "active" : ""}`}
                type="button"
                onClick={() => selectDrawTool("ellipse")}
              >
                <Circle size={15} />
                Oval
              </button>
            </div>
            <div className="draw-workspace-actions">
              {drawTool === "pen" && (
                <>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={undoPenPoint}
                    disabled={penNodes.length === 0}
                  >
                    <Undo2 size={15} />
                    Undo
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={finishPenPath}
                    disabled={penNodes.length < 2}
                  >
                    <Check size={15} />
                    Finish
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={closePenPath}
                    disabled={penNodes.length < 3}
                  >
                    Close
                  </button>
                </>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={clearDrawing}
                disabled={visibleDrawStrokes.length === 0 && penNodes.length === 0}
              >
                <Trash2 size={15} />
                Clear
              </button>
              <button className="button primary" type="button" onClick={handleApply}>
                <Play size={15} />
                Apply
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Exit expanded canvas"
                title="Exit"
                onClick={() => setDrawFullscreen(false)}
              >
                <Minimize2 size={16} />
              </button>
            </div>
          </div>
          <div className="draw-workspace-body">
            <svg
              className={`draw-pad draw-pad-expanded ${drawTool === "pen" ? "pen-mode" : ""}`}
              viewBox={`0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}`}
              role="img"
              aria-label="Expanded SVG drawing canvas"
              onPointerDown={handleDrawPointerDown}
              onPointerMove={handleDrawPointerMove}
              onPointerUp={handleDrawPointerEnd}
              onPointerCancel={handleDrawPointerEnd}
            >
              <defs>
                <pattern
                  id="draw-grid-expanded"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.08)" />
                </pattern>
              </defs>
              <rect width={DRAW_WIDTH} height={DRAW_HEIGHT} fill="url(#draw-grid-expanded)" />
              <rect
                x="1"
                y="1"
                width={DRAW_WIDTH - 2}
                height={DRAW_HEIGHT - 2}
                fill="none"
                stroke="rgba(255,255,255,0.18)"
              />
              {visibleDrawStrokes.map((stroke, index) => (
                <path
                  key={`expanded-${index}-${getStrokePointCount(stroke)}-${stroke.tool}-${isStrokeClosed(stroke) ? "closed" : "open"}`}
                  d={pathFromStroke(stroke)}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {penPreviewStroke && (
                <path
                  className="pen-preview-path"
                  d={pathFromStroke(penPreviewStroke)}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {drawTool === "pen" &&
                penNodes.map((node, index) => (
                  <g key={`expanded-${index}-${node.point.x}-${node.point.y}`}>
                    {node.in && (
                      <>
                        <line
                          className="pen-handle-line"
                          x1={node.point.x}
                          y1={node.point.y}
                          x2={node.in.x}
                          y2={node.in.y}
                        />
                        <circle
                          className="pen-handle"
                          cx={node.in.x}
                          cy={node.in.y}
                          r="3.4"
                          onPointerDown={(event) =>
                            startPenControlDrag(event, { type: "in", index })
                          }
                        />
                      </>
                    )}
                    {node.out && (
                      <>
                        <line
                          className="pen-handle-line"
                          x1={node.point.x}
                          y1={node.point.y}
                          x2={node.out.x}
                          y2={node.out.y}
                        />
                        <circle
                          className="pen-handle"
                          cx={node.out.x}
                          cy={node.out.y}
                          r="3.4"
                          onPointerDown={(event) =>
                            startPenControlDrag(event, { type: "out", index })
                          }
                        />
                      </>
                    )}
                    <circle
                      className="pen-anchor"
                      cx={node.point.x}
                      cy={node.point.y}
                      r="4.2"
                      onPointerDown={(event) =>
                        startPenControlDrag(event, { type: "anchor", index })
                      }
                    />
                  </g>
                ))}
            </svg>
          </div>
          <div className="draw-workspace-footer">
            <span>{drawStrokes.length} paths</span>
            {drawTool === "pen" && penNodes.length > 0 && <span>{penNodes.length} anchors</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const progress = clamp(((value - min) / (max - min)) * 100, 0, 100);
  const formattedValue = format ? format(value) : value.toFixed(step < 1 ? 2 : 0);
  const sliderStyle = {
    "--slider-progress": `${progress}%`
  } as CSSProperties;

  return (
    <label className="slider-row" style={sliderStyle}>
      <span className="slider-content">
        <span>{label}</span>
        <output>{formattedValue}</output>
      </span>
      <span className="slider-ticks" aria-hidden="true" />
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorControl({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value.toUpperCase());

  useEffect(() => {
    setDraftValue(value.toUpperCase());
  }, [value]);

  const commitColor = (nextValue: string) => {
    const parsedColor = parseHexColor(nextValue);

    if (parsedColor) {
      onChange(parsedColor);
      setDraftValue(parsedColor.toUpperCase());
      return;
    }

    setDraftValue(value.toUpperCase());
  };

  return (
    <div className="color-control">
      <label className="color-picker" aria-label={`${label} particle color`}>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="color-control-swatch" style={{ background: value }} />
      </label>
      <label className="color-meta">
        <strong>{label}</strong>
        <input
          aria-label={`${label} hex color`}
          spellCheck={false}
          value={draftValue}
          onBlur={() => commitColor(draftValue)}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDraftValue(nextValue);

            const parsedColor = parseHexColor(nextValue);
            if (parsedColor) {
              onChange(parsedColor);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </label>
    </div>
  );
}

function parseHexColor(value: string) {
  const trimmedValue = value.trim();
  const candidate = trimmedValue.startsWith("#") ? trimmedValue : `#${trimmedValue}`;

  if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return candidate.toLowerCase();
  }

  return null;
}

function detectWebGlSupport() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function getDrawPoint(event: ReactPointerEvent<SVGSVGElement>): DrawPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * DRAW_WIDTH, 0, DRAW_WIDTH),
    y: clamp(((event.clientY - rect.top) / rect.height) * DRAW_HEIGHT, 0, DRAW_HEIGHT)
  };
}

function buildDrawingSvg(strokes: DrawStroke[]) {
  const paths = strokes
    .filter((stroke) => getStrokePointCount(stroke) > 0)
    .map((stroke) => {
      return `  <path d="${pathFromStroke(stroke)}" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("\n");

  return `<svg viewBox="0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
}

function pathFromStroke(stroke: DrawStroke) {
  if (stroke.tool === "pen") {
    return cubicPathFromNodes(stroke.nodes, stroke.closed);
  }

  if (stroke.tool === "brush") {
    return smoothPathFromPoints(stroke.points);
  }

  return pathFromShape(stroke);
}

function getStrokePointCount(stroke: DrawStroke) {
  if (stroke.tool === "pen") {
    return stroke.nodes.length;
  }

  if (stroke.tool === "brush") {
    return stroke.points.length;
  }

  return 2;
}

function isStrokeClosed(stroke: DrawStroke) {
  return stroke.tool === "pen" && Boolean(stroke.closed);
}

function isShapeTool(tool: DrawTool): tool is ShapeStroke["tool"] {
  return tool === "line" || tool === "rect" || tool === "ellipse";
}

function isSurfaceLogoStyle(style: LogoStyle) {
  return (
    style === "ripples" ||
    style === "lines" ||
    style === "mercury" ||
    style === "chrome" ||
    style === "radiance" ||
    style === "dither" ||
    style === "bulge" ||
    style === "gommage" ||
    style === "access" ||
    style === "glitch" ||
    style === "trail" ||
    style === "fluid" ||
    style === "fluidglass" ||
    style === "shadow" ||
    style === "vfx"
  );
}

function getColorControlLabels(style: LogoStyle) {
  if (style === "metal") {
    return {
      ariaLabel: "3D metal material colors",
      primary: "Metal",
      accent: "Reflection",
      highlight: "Spec"
    };
  }

  if (style === "chrome") {
    return {
      ariaLabel: "Chrome shader colors",
      primary: "Base",
      accent: "Blue",
      highlight: "Hot"
    };
  }

  if (style === "mercury") {
    return {
      ariaLabel: "Liquid metal shader colors",
      primary: "Silver",
      accent: "Shadow",
      highlight: "Spec"
    };
  }

  if (style === "vfx") {
    return {
      ariaLabel: "VFX shader colors",
      primary: "Source",
      accent: "Cyan",
      highlight: "Pink"
    };
  }

  if (style === "ascii2") {
    return {
      ariaLabel: "ASCII raster colors",
      primary: "Text",
      accent: "Glow",
      highlight: "Split"
    };
  }

  if (style === "fancy") {
    return {
      ariaLabel: "Fancy SVG stroke colors",
      primary: "Top",
      accent: "Warm",
      highlight: "Cool"
    };
  }

  if (style === "bulge") {
    return {
      ariaLabel: "Bulge lens colors",
      primary: "Face",
      accent: "Glass",
      highlight: "Prism"
    };
  }

  if (style === "gommage") {
    return {
      ariaLabel: "Gommage shader colors",
      primary: "Base",
      accent: "Dust",
      highlight: "Edge"
    };
  }

  if (style === "elastic") {
    return {
      ariaLabel: "Elastic vertex colors",
      primary: "Surface",
      accent: "Emission",
      highlight: "Velocity"
    };
  }

  if (style === "hyperspace") {
    return {
      ariaLabel: "Hyperspace particle colors",
      primary: "Stars",
      accent: "Tunnel",
      highlight: "Core"
    };
  }

  if (style === "access") {
    return {
      ariaLabel: "Accessible WebGL text colors",
      primary: "Text",
      accent: "Cyan",
      highlight: "Magenta"
    };
  }

  if (style === "glitch") {
    return {
      ariaLabel: "Glitch shader colors",
      primary: "Signal",
      accent: "Cyan",
      highlight: "Magenta"
    };
  }

  if (style === "trail") {
    return {
      ariaLabel: "Text trail feedback colors",
      primary: "Source",
      accent: "Persist",
      highlight: "Spark"
    };
  }

  if (style === "fluid") {
    return {
      ariaLabel: "Fluid reveal colors",
      primary: "Solid",
      accent: "Fluid",
      highlight: "CRT"
    };
  }

  if (style === "fluidglass") {
    return {
      ariaLabel: "Fluid glass colors",
      primary: "Glass",
      accent: "Caustic",
      highlight: "Spec"
    };
  }

  if (style === "shadow") {
    return {
      ariaLabel: "Shadow lift colors",
      primary: "Paper",
      accent: "Shadow",
      highlight: "Rim"
    };
  }

  if (style === "clouds") {
    return {
      ariaLabel: "Cloud typing colors",
      primary: "Smoke",
      accent: "Shade",
      highlight: "Light"
    };
  }

  if (style === "bubbles") {
    return {
      ariaLabel: "Bubble typing colors",
      primary: "Glass",
      accent: "Water",
      highlight: "Spark"
    };
  }

  if (style === "blossom") {
    return {
      ariaLabel: "Blossom typing colors",
      primary: "Petal",
      accent: "Leaf",
      highlight: "Pollen"
    };
  }

  if (style === "gaze") {
    return {
      ariaLabel: "Gaze typing colors",
      primary: "Sclera",
      accent: "Iris",
      highlight: "Pupil"
    };
  }

  return {
    ariaLabel: "Particle colors",
    primary: "Core",
    accent: "Field",
    highlight: "Hot"
  };
}

function getTypingControlLabels(style: LogoStyle) {
  if (style === "clouds") {
    return {
      title: "Cloud typing controls",
      size: "Puff size",
      motion: "Puff drift",
      spread: "Puff scatter",
      cursor: "Mouse breeze",
      focus: "Breeze radius",
      detail: "Soft edge",
      variance: "Texture grain",
      pulse: "Pulsate",
      speed: "Grow speed"
    };
  }

  if (style === "bubbles") {
    return {
      title: "Bubble typing controls",
      size: "Bubble size",
      motion: "Buoyancy",
      spread: "Bubble spread",
      cursor: "Cursor stir",
      focus: "Stir radius",
      detail: "Ring thickness",
      variance: "Sparkle",
      pulse: "Float pulse",
      speed: "Rise speed"
    };
  }

  if (style === "blossom") {
    return {
      title: "Blossom typing controls",
      size: "Petal size",
      motion: "Sway",
      spread: "Scatter bloom",
      cursor: "Cursor breeze",
      focus: "Breeze radius",
      detail: "Leaf mix",
      variance: "Color variance",
      pulse: "Growth pulse",
      speed: "Bloom speed"
    };
  }

  if (style === "gaze") {
    return {
      title: "Gaze typing controls",
      size: "Eye size",
      motion: "Look jitter",
      spread: "Depth spread",
      cursor: "Pupil follow",
      focus: "Focus radius",
      detail: "Iris ring",
      variance: "Blink noise",
      pulse: "Blink pulse",
      speed: "Growth speed"
    };
  }

  return null;
}

function pathFromShape(stroke: ShapeStroke) {
  const x1 = stroke.start.x;
  const y1 = stroke.start.y;
  const x2 = stroke.end.x;
  const y2 = stroke.end.y;

  if (stroke.tool === "line") {
    return `M ${formatPoint(x1)} ${formatPoint(y1)} L ${formatPoint(x2)} ${formatPoint(y2)}`;
  }

  if (stroke.tool === "rect") {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);
    return `M ${formatPoint(left)} ${formatPoint(top)} H ${formatPoint(right)} V ${formatPoint(bottom)} H ${formatPoint(left)} Z`;
  }

  const centerX = (x1 + x2) * 0.5;
  const centerY = (y1 + y2) * 0.5;
  const radiusX = Math.max(Math.abs(x2 - x1) * 0.5, 0.1);
  const radiusY = Math.max(Math.abs(y2 - y1) * 0.5, 0.1);
  const left = centerX - radiusX;
  const right = centerX + radiusX;

  return `M ${formatPoint(left)} ${formatPoint(centerY)} A ${formatPoint(radiusX)} ${formatPoint(radiusY)} 0 1 0 ${formatPoint(right)} ${formatPoint(centerY)} A ${formatPoint(radiusX)} ${formatPoint(radiusY)} 0 1 0 ${formatPoint(left)} ${formatPoint(centerY)}`;
}

function smoothPathFromPoints(points: DrawPoint[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    const point = points[0];
    return `M ${formatPoint(point.x)} ${formatPoint(point.y)} L ${formatPoint(point.x + 0.1)} ${formatPoint(point.y + 0.1)}`;
  }

  let path = `M ${formatPoint(points[0].x)} ${formatPoint(points[0].y)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const nextPoint = points[index + 1];
    const midX = (point.x + nextPoint.x) * 0.5;
    const midY = (point.y + nextPoint.y) * 0.5;
    path += ` Q ${formatPoint(point.x)} ${formatPoint(point.y)} ${formatPoint(midX)} ${formatPoint(midY)}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` L ${formatPoint(lastPoint.x)} ${formatPoint(lastPoint.y)}`;
  return path;
}

function cubicPathFromNodes(nodes: PenNode[], closed = false) {
  if (nodes.length === 0) {
    return "";
  }

  if (nodes.length === 1) {
    const point = nodes[0].point;
    return `M ${formatPoint(point.x)} ${formatPoint(point.y)} L ${formatPoint(point.x + 0.1)} ${formatPoint(point.y + 0.1)}`;
  }

  let path = `M ${formatPoint(nodes[0].point.x)} ${formatPoint(nodes[0].point.y)}`;
  const segmentCount = closed ? nodes.length : nodes.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const current = nodes[index];
    const next = nodes[(index + 1) % nodes.length];
    const controlOut = current.out ?? current.point;
    const controlIn = next.in ?? next.point;

    path += ` C ${formatPoint(controlOut.x)} ${formatPoint(controlOut.y)} ${formatPoint(controlIn.x)} ${formatPoint(controlIn.y)} ${formatPoint(next.point.x)} ${formatPoint(next.point.y)}`;
  }

  return `${path}${closed ? " Z" : ""}`;
}

function updatePenDrag(nodes: PenNode[], drag: PenDrag, point: DrawPoint) {
  return nodes.map((node, index) => {
    if (index !== drag.index) {
      return node;
    }

    if (drag.type === "anchor") {
      const delta = {
        x: point.x - node.point.x,
        y: point.y - node.point.y
      };

      return {
        ...node,
        point,
        in: node.in ? addPoint(node.in, delta) : undefined,
        out: node.out ? addPoint(node.out, delta) : undefined
      };
    }

    if (drag.type === "new-node") {
      if (distance(node.point, point) < 4) {
        return {
          ...node,
          in: undefined,
          out: undefined
        };
      }

      return {
        ...node,
        in: mirrorPoint(node.point, point),
        out: point
      };
    }

    return {
      ...node,
      [drag.type]: point
    };
  });
}

function distance(a: DrawPoint, b: DrawPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function addPoint(point: DrawPoint, delta: DrawPoint) {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y
  };
}

function mirrorPoint(origin: DrawPoint, point: DrawPoint) {
  return {
    x: origin.x * 2 - point.x,
    y: origin.y * 2 - point.y
  };
}

function formatPoint(value: number) {
  return Number(value.toFixed(1));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
