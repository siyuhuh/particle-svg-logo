import type { LogoStyle } from "./types";

export type LogoStyleMeta = {
  id: LogoStyle;
  label: string;
  hudLabel: string;
  detail: string;
};

export type VisibleLogoStyle = LogoStyleMeta & {
  devOnly: boolean;
};

/** Shipped on production — reorder here when promoting a dev effect. */
export const PRODUCTION_LOGO_STYLE_IDS = [
  "walkers",
  "sdf",
  "bubbles",
  "dust",
  "lines",
  "ascii",
  "ascii2",
  "metal",
  "gommage",
  "hyperspace",
  "glitch",
  "trail",
  "fluid",
  "fluidglass",
  "blossom",
  "vfx"
] as const satisfies readonly LogoStyle[];

export const LOGO_STYLES: LogoStyleMeta[] = [
  { id: "dust", label: "Particles", hudLabel: "PARTICLES", detail: "white particle flow" },
  { id: "lines", label: "Lines", hudLabel: "LINES", detail: "thin scan strokes" },
  { id: "ascii", label: "ASCII", hudLabel: "ASCII", detail: "glyph particle field" },
  { id: "ascii2", label: "ASCII 2", hudLabel: "ASCII 2", detail: "raster text filter" },
  { id: "walkers", label: "Walkers", hudLabel: "WALKERS", detail: "webcam crowd flow" },
  { id: "sdf", label: "SDF", hudLabel: "SDF", detail: "soft rising puffs" },
  { id: "metal", label: "Metal", hudLabel: "METAL", detail: "extruded silver 3D" },
  { id: "gommage", label: "Gommage", hudLabel: "GOMMAGE", detail: "powder dissolve" },
  { id: "hyperspace", label: "Hyperspace", hudLabel: "HYPERSPACE", detail: "warp tunnel particles" },
  { id: "glitch", label: "Glitch", hudLabel: "GLITCH", detail: "RGB slice reveal" },
  { id: "trail", label: "Trail", hudLabel: "TRAIL", detail: "framebuffer text trail" },
  { id: "fluid", label: "Fluid", hudLabel: "FLUID", detail: "mouse fluid reveal" },
  { id: "fluidglass", label: "Fluid Glass", hudLabel: "GLASS", detail: "reaction glass flow" },
  { id: "blossom", label: "Blossom", hudLabel: "BLOSSOM", detail: "flower leaf type" },
  { id: "vfx", label: "VFX", hudLabel: "VFX", detail: "thru light shadow" },
  { id: "ripples", label: "Ripples", hudLabel: "RIPPLES", detail: "ring wave pulses" },
  { id: "fancy", label: "Fancy", hudLabel: "FANCY", detail: "layered SVG strokes" },
  { id: "mercury", label: "Mercury", hudLabel: "MERCURY", detail: "liquid chrome relief" },
  { id: "chrome", label: "Chrome", hudLabel: "CHROME", detail: "prismatic flow metal" },
  { id: "radiance", label: "Radiance", hudLabel: "RADIANCE", detail: "red beam glow" },
  { id: "dither", label: "Dither", hudLabel: "DITHER", detail: "ordered halftone" },
  { id: "bulge", label: "Bulge", hudLabel: "BULGE", detail: "refractive 3D lens" },
  { id: "elastic", label: "Elastic", hudLabel: "ELASTIC", detail: "vertex destruction" },
  { id: "access", label: "Access", hudLabel: "ACCESS", detail: "text reveal RGB shift" },
  { id: "shadow", label: "Shadow", hudLabel: "SHADOW", detail: "lifted SVG shadow" },
  { id: "clouds", label: "Clouds", hudLabel: "CLOUDS", detail: "smoke typing puffs" },
  { id: "bubbles", label: "Bubbles", hudLabel: "BUBBLES", detail: "rising bubble type" },
  { id: "gaze", label: "Gaze", hudLabel: "GAZE", detail: "pupil follow type" }
];

const LOGO_STYLE_BY_ID = new Map(LOGO_STYLES.map((style) => [style.id, style]));
const PRODUCTION_ID_SET = new Set<string>(PRODUCTION_LOGO_STYLE_IDS);

export const ALL_LOGO_STYLE_IDS = new Set<string>(LOGO_STYLES.map((style) => style.id));

export function isProductionLogoStyle(id: LogoStyle) {
  return PRODUCTION_ID_SET.has(id);
}

export function getVisibleLogoStyles(includeDev = import.meta.env.DEV): VisibleLogoStyle[] {
  const production = PRODUCTION_LOGO_STYLE_IDS.map((id) => {
    const style = LOGO_STYLE_BY_ID.get(id);
    if (!style) {
      throw new Error(`Missing production logo style: ${id}`);
    }
    return { ...style, devOnly: false };
  });

  if (!includeDev) {
    return production;
  }

  const devOnly = LOGO_STYLES.filter((style) => !PRODUCTION_ID_SET.has(style.id)).map((style) => ({
    ...style,
    devOnly: true
  }));

  return [...production, ...devOnly];
}

export const DEFAULT_LOGO_STYLE: LogoStyle = "walkers";

export function logoStyleToPath(style: LogoStyle) {
  return style === DEFAULT_LOGO_STYLE ? "/" : `/${style}`;
}

export function resolveLogoStyleFromSlug(slug: string, includeDev = import.meta.env.DEV): LogoStyle {
  if (!slug || !ALL_LOGO_STYLE_IDS.has(slug)) {
    return DEFAULT_LOGO_STYLE;
  }

  const id = slug as LogoStyle;
  if (!includeDev && !isProductionLogoStyle(id)) {
    return DEFAULT_LOGO_STYLE;
  }

  return id;
}
