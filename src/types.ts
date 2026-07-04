export type LogoSource = {
  kind: "upload" | "paste";
  name?: string;
  svgText: string;
};

export type RenderMode = "webgl" | "webgpu-tsl";
export type FancyVariant = "effect1" | "effect2" | "effect3" | "effect4";
export type SdfMotionMode = "drift" | "aquarium";
export type LogoStyle =
  | "dust"
  | "ripples"
  | "lines"
  | "metal"
  | "mercury"
  | "chrome"
  | "radiance"
  | "dither"
  | "bulge"
  | "gommage"
  | "elastic"
  | "hyperspace"
  | "access"
  | "glitch"
  | "trail"
  | "fluid"
  | "fluidglass"
  | "shadow"
  | "clouds"
  | "bubbles"
  | "blossom"
  | "gaze"
  | "vfx"
  | "ascii"
  | "ascii2"
  | "fancy"
  | "walkers"
  | "sdf";

export type ParticleSettings = {
  logoStyle: LogoStyle;
  particleColor: string;
  particleAccentColor: string;
  particleHighlightColor: string;
  asciiCharacters: string;
  fancyVariant: FancyVariant;
  particleCount: number;
  pointSize: number;
  turbulence: number;
  scatterRadius: number;
  mouseForce: number;
  attractRadius: number;
  repelRadius: number;
  flicker: number;
  breathe: number;
  maskRoughness: number;
  surfaceDepth: number;
  animationSpeed: number;
  /** Walkers: how fast the crowd strolls back home after being shoved (0 = slow). */
  walkerReturnSpeed: number;
  /** Walkers: how much they curve/meander on the way home instead of beelining. */
  walkerWander: number;
  /** SDF: drift = omnidirectional metaballs; aquarium = rising aerator bubbles. */
  sdfMotionMode: SdfMotionMode;
  gridVisible: boolean;
  renderMode: RenderMode;
};

export type ParticleBuffers = {
  count: number;
  positions: Float32Array;
  origins: Float32Array;
  seeds: Float32Array;
  sizes: Float32Array;
  delays: Float32Array;
  intensities: Float32Array;
};
