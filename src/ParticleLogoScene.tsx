import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { StrokeStyle } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  LOGO_CONTENT_WORLD_SIZE,
  SURFACE_MASK_FILL_RATIO,
  SURFACE_PLANE_WORLD_SIZE
} from "./sceneSizing";
import { sampleSvgToParticles } from "./svgSampler";
import { alignTargetPositions } from "./logoMorph";
import { WebcamWalkersOverlay } from "./WebcamWalkersOverlay";
import { HandPointerControl } from "./HandPointerControl";
import { handInput } from "./handInput";
import type { HandGesture } from "./handGestures";
import type { TrackedHand } from "./useHandTracking";
import type { LogoStyle, ParticleBuffers, ParticleSettings } from "./types";

type ParticleLogoSceneProps = {
  svgText: string;
  svgTextB?: string;
  morphBlend?: number;
  captureClean?: boolean;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
  webglSupported: boolean;
  webgpuSupported: boolean;
};

const SURFACE_TEXTURE_SIZE = 1024;
const ASCII_ATLAS_COLUMNS = 16;
const ASCII_ATLAS_ROWS = 4;
const ASCII_ATLAS_MAX_CHARACTERS = ASCII_ATLAS_COLUMNS * ASCII_ATLAS_ROWS;
const DEFAULT_ASCII_CHARACTERS = "01<>/\\*#@";
const DEFAULT_ASCII_RASTER_CHARACTERS =
  " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

type ChromeGeometryModel = {
  geometries: THREE.BufferGeometry[];
};

type FancyLetterPath = {
  d: string;
  transform?: string;
};

type FancyLetterModel = {
  viewBox: string;
  paths: FancyLetterPath[];
};

type SurfaceMaskCacheEntry = {
  sampled: HTMLCanvasElement | null;
  vector: HTMLCanvasElement | null;
};

const surfaceMaskCanvasCache = new Map<string, SurfaceMaskCacheEntry>();

const vertexShader = `
  attribute vec3 aOrigin;
  attribute vec3 aTargetB;
  attribute float aSeed;
  attribute float aSize;
  attribute float aDelay;
  attribute float aIntensity;

  uniform float uTime;
  uniform float uProgress;
  uniform float uPointSize;
  uniform float uScatter;
  uniform float uTurbulence;
  uniform float uMouseForce;
  uniform float uMouseActive;
  uniform float uAttractRadius;
  uniform float uRepelRadius;
  uniform float uBreathe;
  uniform float uBirthPulse;
  uniform float uDpr;
  uniform float uStyle;
  uniform float uMotionSpeed;
  uniform float uMorph;
  uniform vec2 uMouse;

  varying float vIntensity;
  varying float vTwinkle;
  varying float vFlow;
  varying float vElastic;
  varying float vHyper;
  varying vec2 vHyperDir;
  varying float vTyping;
  varying float vMouseMask;
  varying float vSeed;
  varying vec2 vTarget;

  float easeOutCubic(float x) {
    return 1.0 - pow(1.0 - clamp(x, 0.0, 1.0), 3.0);
  }

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec2 hash22(vec2 p) {
    return vec2(hash21(p), hash21(p + vec2(19.19))) * 2.0 - 1.0;
  }

  vec3 spectrum(float x) {
    return max(
      vec3(0.0),
      cos((vec3(x) - vec3(0.0, 0.5, 1.0)) * vec3(0.6, 1.0, 0.5) * 3.14159265)
    );
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = rotate * p * 2.03 + vec2(19.7, 7.3);
      amplitude *= 0.5;
    }

    return value;
  }

  vec2 curlNoise(vec2 p) {
    float e = 0.08;
    float n1 = fbm(p + vec2(0.0, e));
    float n2 = fbm(p - vec2(0.0, e));
    float n3 = fbm(p + vec2(e, 0.0));
    float n4 = fbm(p - vec2(e, 0.0));
    float dy = (n1 - n2) / (2.0 * e);
    float dx = (n3 - n4) / (2.0 * e);
    return vec2(dy, -dx);
  }

  void main() {
    float localProgress = easeOutCubic((uProgress - aDelay) * 1.55);
    float elasticStyle = 1.0 - step(0.5, abs(uStyle - 11.0));
    float hyperStyle = 1.0 - step(0.5, abs(uStyle - 12.0));
    float cloudStyle = 1.0 - step(0.5, abs(uStyle - 14.0));
    float bubbleStyle = 1.0 - step(0.5, abs(uStyle - 15.0));
    float blossomStyle = 1.0 - step(0.5, abs(uStyle - 16.0));
    float gazeStyle = 1.0 - step(0.5, abs(uStyle - 17.0));
    float typingStyle = max(max(cloudStyle, bubbleStyle), max(blossomStyle, gazeStyle));
    vec3 target = mix(position, aTargetB, clamp(uMorph, 0.0, 1.0));
    vec3 origin = aOrigin;
    vec3 formed = mix(origin, target, localProgress);
    float driftA = aSeed * 0.013 + uTime * (0.45 + hash(aSeed) * 0.65);
    float driftB = aSeed * 0.029 - uTime * 0.38;
    vec3 drift = vec3(
      sin(driftA),
      cos(driftB),
      sin(driftA + driftB)
    );

    float loose = 1.0 - localProgress;
    formed += drift * loose * uScatter * 0.34;

    vec2 flowDomain = target.xy * 1.55 + vec2(uTime * 0.19, -uTime * 0.13);
    flowDomain += vec2(hash(aSeed) * 12.0, hash(aSeed + 17.0) * 12.0);
    vec2 flow = curlNoise(flowDomain);
    float flowPulse = fbm(target.xy * 2.3 + vec2(-uTime * 0.21, uTime * 0.17) + aSeed * 0.007);
    float flowMask = 0.24 + localProgress * 0.76;

    formed.xy += flow * uTurbulence * 0.115 * flowMask;
    formed.xy += flow * uBirthPulse * uTurbulence * 0.11 * localProgress;
    formed.xy += drift.xy * uTurbulence * 0.012;
    formed.z += (flowPulse - 0.5) * uTurbulence * 0.26;
    formed.z += uBirthPulse * (flowPulse - 0.5) * uTurbulence * 0.45;
    formed.z += sin(uTime * 1.8 + aSeed) * uTurbulence * 0.035;
    formed.xy *= 1.0 + sin(uTime * 1.55 + aSeed * 0.002) * uBreathe * localProgress;

    vec2 toMouse = target.xy - uMouse;
    float mouseDistance = length(toMouse);
    vec2 mouseDirection = toMouse / max(mouseDistance, 0.001);
    vec2 mouseTangent = vec2(-mouseDirection.y, mouseDirection.x);
    float attractRadius = max(0.05, uAttractRadius);
    float repelRadius = max(0.02, uRepelRadius);
    float fieldFalloff = exp(-(mouseDistance * mouseDistance) / (attractRadius * attractRadius));
    float centerSoftener = smoothstep(repelRadius * 0.25, repelRadius, mouseDistance);
    float magneticBand = sin(mouseDistance * 4.2 - uTime * 2.1 + aSeed * 0.009);
    float mouseMask = fieldFalloff * centerSoftener * uMouseActive;
    vec2 magneticFlow = mouseTangent * (0.26 + magneticBand * 0.11);
    magneticFlow += mouseDirection * magneticBand * 0.055;
    formed.xy += magneticFlow * mouseMask * uMouseForce;
    formed.z += mouseMask * uMouseForce * (0.08 + 0.08 * magneticBand);

    float typingSpeed = max(0.2, uMotionSpeed);
    float typingSeed = hash(aSeed * 0.31 + 4.7);
    float typingRise = fract(typingSeed + uTime * typingSpeed * (0.045 + hash(aSeed + 8.0) * 0.025));
    float flyingBubble = step(0.93, hash(aSeed + 51.0));
    vec2 typingWind = curlNoise(target.xy * (1.8 + uTurbulence * 0.25) + vec2(uTime * 0.12, -uTime * 0.08) + aSeed * 0.005);
    vec2 cloudOffset = hash22(vec2(aSeed * 0.41, aSeed * 0.17 + 9.3));
    formed.xy += cloudOffset * cloudStyle * localProgress * uScatter * 0.055;
    formed.xy += typingWind * cloudStyle * localProgress * uTurbulence * (0.024 + uScatter * 0.01);
    formed.z += cloudStyle * localProgress * (hash(aSeed + 33.0) - 0.5) * (0.28 + uScatter * 0.12);
    formed.x += bubbleStyle * localProgress * sin(uTime * (0.9 + typingSeed) + aSeed) * uTurbulence * 0.08;
    formed.y += bubbleStyle * localProgress * flyingBubble * typingRise * (0.38 + uScatter * 0.24);
    formed.z += bubbleStyle * localProgress * (hash(aSeed + 33.0) - 0.5) * (0.5 + uScatter * 0.2);
    formed.xy += blossomStyle * localProgress * typingWind * (0.08 + uTurbulence * 0.08);
    formed.y += blossomStyle * localProgress * sin(uTime * typingSpeed * 0.7 + aSeed * 0.02) * uBreathe * 0.24;
    formed.z += blossomStyle * localProgress * (hash(aSeed + 72.0) - 0.5) * (0.32 + uScatter * 0.18);
    formed.z += gazeStyle * localProgress * (hash(aSeed + 19.0) - 0.5) * (0.4 + uScatter * 0.42);
    formed.xy += gazeStyle * localProgress * typingWind * uTurbulence * 0.035;

    vec3 elasticNormal = normalize(vec3(
      target.xy + hash22(vec2(aSeed, aSeed * 0.37)) * 0.24,
      0.42 + hash(aSeed + 91.0) * 0.58
    ));
    float elasticRadius = max(0.18, uAttractRadius * 1.2);
    float elasticHit = exp(-(mouseDistance * mouseDistance) / (elasticRadius * elasticRadius));
    float elasticPress = elasticStyle * (0.18 + uMouseActive * 0.82) * localProgress;
    float elasticNoise = fbm(target.xy * (2.6 + uTurbulence) + vec2(uTime * 0.22, -uTime * 0.17) + aSeed * 0.01);
    float elasticWave = sin(mouseDistance * (9.0 + uScatter * 3.0) - uTime * (5.2 + uBreathe * 8.0) + aSeed * 0.025);
    vec3 elasticPush = elasticNormal *
      (elasticNoise - 0.38 + elasticWave * 0.22) *
      elasticHit *
      elasticPress *
      uMouseForce *
      (0.42 + uScatter * 0.28);
    formed.xy += mouseTangent * elasticHit * elasticPress * elasticWave * uScatter * 0.22;
    formed.xy += flow * elasticStyle * elasticPress * uTurbulence * 0.18 * (0.4 + elasticHit);
    formed += elasticPush;
    formed.z += elasticStyle * elasticHit * elasticPress * uMouseForce * (0.22 + elasticNoise * 0.38);
    float elasticDisplacement = length(elasticPush) + elasticHit * elasticPress * (0.18 + abs(elasticWave) * 0.22);

    vec2 hyperSeedOffset = hash22(vec2(aSeed * 0.07, aSeed * 0.19)) * 0.12;
    vec2 hyperVector = target.xy + hyperSeedOffset;
    float hyperRadial = max(length(hyperVector), 0.001);
    vec2 hyperDir = hyperVector / hyperRadial;
    float hyperSpeed = max(0.15, uMotionSpeed);
    float hyperPhase = fract(hash(aSeed * 0.173) + uTime * hyperSpeed * (0.08 + uScatter * 0.025));
    float hyperClose = pow(hyperPhase, 2.35);
    float hyperGate = hyperStyle * localProgress;
    float hyperPulse = sin((1.0 - hyperPhase) * 18.0 + uTime * hyperSpeed * 1.7 + aSeed * 0.031);
    float hyperNoise = fbm(hyperDir * (6.0 + uTurbulence * 2.0) + vec2(uTime * 0.12, aSeed * 0.003));
    vec2 hyperMouseBend = (uMouse - target.xy) *
      exp(-(mouseDistance * mouseDistance) / max(attractRadius * attractRadius, 0.001)) *
      uMouseActive *
      uMouseForce *
      0.08;
    vec2 tunnelOffset = hyperDir *
      (hyperClose * hyperClose) *
      (0.58 + hyperRadial * 0.22 + uScatter * 0.42);
    tunnelOffset += hyperDir * (hyperNoise - 0.5) * uTurbulence * 0.1;
    tunnelOffset += hyperMouseBend;
    formed.xy = mix(formed.xy, target.xy * (0.72 + 0.18 * localProgress) + tunnelOffset, hyperGate);
    formed.z += hyperGate * mix(-3.8 - uScatter * 1.8, 1.6, hyperClose);
    formed.xy += hyperDir * hyperGate * hyperPulse * uBreathe * 0.22;
    float hyperEnergy = hyperStyle * (0.24 + hyperClose * 1.25 + abs(hyperPulse) * 0.18);

    vec4 mvPosition = modelViewMatrix * vec4(formed, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float perspective = 6.0 / max(1.0, -mvPosition.z);
    float pulse = 0.78 + 0.16 * sin(uTime * 7.0 + aSeed) + flowPulse * 0.12 + uBirthPulse * 0.2;
    pulse *= 1.0 + sin(uTime * 2.0 + aSeed * 0.003) * uBreathe;
    gl_PointSize = uPointSize *
      aSize *
      pulse *
      perspective *
      uDpr *
      mix(1.0, 1.0 + elasticDisplacement * 0.7, elasticStyle) *
      mix(1.0, 0.72 + hyperClose * 1.25, hyperStyle);
    float typingPointScale = 1.0;
    float cloudScalePulse = 0.88 + sin(uTime * (0.72 + typingSeed * 0.62) + aSeed * 0.031) * (0.08 + uBreathe * 0.22);
    typingPointScale = mix(
      typingPointScale,
      (1.45 + hash(aSeed + 2.0) * 1.25) * cloudScalePulse + uBreathe * 0.42,
      cloudStyle
    );
    typingPointScale = mix(typingPointScale, 1.2 + typingRise * 0.85 + uRepelRadius * 0.42, bubbleStyle);
    typingPointScale = mix(typingPointScale, 0.92 + hash(aSeed + 5.0) * 1.15 + uBreathe * 0.45, blossomStyle);
    typingPointScale = mix(typingPointScale, 1.1 + hash(aSeed + 9.0) * 0.55 + uRepelRadius * 0.35, gazeStyle);
    gl_PointSize *= mix(1.0, typingPointScale, typingStyle);

    vIntensity = aIntensity * (0.38 + localProgress * 0.9 + flowPulse * 0.26 + mouseMask * 0.22 + hyperEnergy * 0.24);
    vTwinkle = 0.62 + 0.24 * sin(uTime * (3.0 + hash(aSeed) * 5.0) + aSeed) + flowPulse * 0.14;
    vFlow = flowPulse;
    vElastic = elasticDisplacement * elasticStyle;
    vHyper = hyperEnergy;
    vHyperDir = hyperDir;
    vTyping = typingRise;
    vMouseMask = mouseMask;
    vSeed = aSeed;
    vTarget = target.xy;
  }
`;

const fragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uStyle;
  uniform float uFlicker;
  uniform float uRepelRadius;
  uniform float uMouseActive;
  uniform vec2 uMouse;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;
  uniform vec3 uColorHighlight;

  varying float vIntensity;
  varying float vTwinkle;
  varying float vFlow;
  varying float vElastic;
  varying float vHyper;
  varying vec2 vHyperDir;
  varying float vTyping;
  varying float vMouseMask;
  varying float vSeed;
  varying vec2 vTarget;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = rotate * p * 2.03 + vec2(7.1, 13.7);
      amplitude *= 0.5;
    }

    return value;
  }

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float distanceFromCenter = length(uv);
    float softDisc = smoothstep(0.5, 0.04, distanceFromCenter);
    float core = smoothstep(0.18, 0.0, distanceFromCenter);
    float rim = smoothstep(0.5, 0.25, distanceFromCenter) * 0.34;
    float alpha = softDisc * (0.16 + vIntensity * 0.24);

    vec3 dustColor = mix(uColorAccent, uColorPrimary, clamp(vIntensity, 0.0, 1.6));
    dustColor *= (0.42 + core * 1.35 + rim) * vTwinkle * vIntensity;
    vec3 color = dustColor;
    float elasticStyle = 1.0 - step(0.5, abs(uStyle - 11.0));
    float hyperStyle = 1.0 - step(0.5, abs(uStyle - 12.0));
    float cloudStyle = 1.0 - step(0.5, abs(uStyle - 14.0));
    float bubbleStyle = 1.0 - step(0.5, abs(uStyle - 15.0));
    float blossomStyle = 1.0 - step(0.5, abs(uStyle - 16.0));
    float gazeStyle = 1.0 - step(0.5, abs(uStyle - 17.0));
    vec3 elasticBase = mix(
      uColorPrimary * 0.52,
      uColorAccent,
      smoothstep(0.08, 0.9, vElastic + vFlow * 0.25)
    );
    elasticBase += uColorHighlight * pow(core, 1.6) * (0.35 + vElastic * 1.8);
    elasticBase += uColorAccent * rim * (0.8 + vElastic * 2.2);
    elasticBase += uColorHighlight * vElastic * 0.38;
    float elasticAlpha = softDisc * (0.18 + vIntensity * 0.34 + vElastic * 0.24);
    color = mix(color, elasticBase, elasticStyle);
    alpha = mix(alpha, elasticAlpha, elasticStyle);

    vec2 hyperDir = normalize(vHyperDir);
    vec2 hyperPerp = vec2(-hyperDir.y, hyperDir.x);
    float hyperAlong = dot(uv, hyperDir);
    float hyperAcross = abs(dot(uv, hyperPerp));
    float hyperLength = 0.36 + uRepelRadius * 0.28 + vHyper * 0.08;
    float hyperTail = smoothstep(0.5, 0.0, hyperAcross * (4.0 - min(uRepelRadius, 2.0) * 0.8));
    hyperTail *= smoothstep(hyperLength, -0.08, abs(hyperAlong));
    hyperTail *= smoothstep(-0.45, 0.12, hyperAlong);
    float hyperHead = smoothstep(0.24, 0.0, distanceFromCenter);
    float hyperSpark = max(hyperHead, hyperTail * (0.38 + vHyper * 0.48));
    vec3 hyperColor = mix(uColorAccent * 0.58, uColorPrimary, hyperHead);
    hyperColor += uColorHighlight * pow(hyperHead, 1.8) * (0.62 + vHyper * 0.65);
    hyperColor += uColorAccent * hyperTail * (0.65 + vHyper * 0.42);
    float hyperAlpha = hyperSpark * (0.12 + vIntensity * 0.34 + vHyper * 0.18);
    color = mix(color, hyperColor, hyperStyle);
    alpha = mix(alpha, hyperAlpha, hyperStyle);

    float cloudAngle = (hash(vSeed + 14.0) - 0.5) * 6.2831853 +
      sin(uTime * 0.12 + vSeed * 0.021) * 0.18;
    mat2 cloudRotate = mat2(cos(cloudAngle), -sin(cloudAngle), sin(cloudAngle), cos(cloudAngle));
    vec2 cloudUv = cloudRotate * uv;
    cloudUv.x *= 0.82 + hash(vSeed + 3.0) * 0.56;
    cloudUv.y *= 0.7 + hash(vSeed + 8.0) * 0.34;
    float cloudLobeA = smoothstep(0.46, 0.02, length(cloudUv + vec2(-0.13, 0.01)));
    float cloudLobeB = smoothstep(0.43, 0.02, length(cloudUv + vec2(0.13, -0.02)));
    float cloudLobeC = smoothstep(0.36, 0.02, length(cloudUv + vec2(0.0, 0.12)));
    float cloudLobeD = smoothstep(0.34, 0.02, length(cloudUv + vec2(0.02, -0.13)));
    float cloudShape = clamp(max(max(cloudLobeA, cloudLobeB), max(cloudLobeC, cloudLobeD)), 0.0, 1.0);
    float cloudTexture = fbm(
      cloudUv * (4.2 + uRepelRadius * 2.6) +
        vec2(hash(vSeed) * 13.0, hash(vSeed + 2.0) * 13.0) +
        vec2(uTime * 0.018, -uTime * 0.012)
    );
    float cloudFeather = smoothstep(0.05, 0.92, cloudTexture + cloudShape * 0.62);
    float cloudCore = smoothstep(0.34, 0.0, length(cloudUv * vec2(0.9, 1.08)));
    float cloudBlob = cloudShape * (0.48 + cloudFeather * 0.52);
    vec3 cloudColor = mix(uColorAccent * 0.62, uColorPrimary, 0.46 + cloudCore * 0.38 + vTwinkle * 0.08);
    cloudColor += uColorHighlight * (cloudCore * 0.16 + cloudFeather * 0.045);
    float cloudAlpha = cloudBlob * (0.11 + vIntensity * 0.09) * (0.78 + vFlow * 0.16);
    color = mix(color, cloudColor, cloudStyle);
    alpha = mix(alpha, cloudAlpha, cloudStyle);

    float bubbleRadius = 0.31 + hash(vSeed + 3.0) * 0.11;
    float bubbleRing = smoothstep(0.05 + uRepelRadius * 0.035, 0.0, abs(distanceFromCenter - bubbleRadius));
    float bubbleFill = smoothstep(bubbleRadius, 0.0, distanceFromCenter) * 0.16;
    float bubbleGlint = smoothstep(0.11, 0.0, length(uv - vec2(-0.16, 0.18)));
    vec3 bubbleColor = uColorAccent * (0.35 + bubbleRing * 0.9);
    bubbleColor += uColorPrimary * bubbleFill + uColorHighlight * bubbleGlint * 0.78;
    float bubbleAlpha = (bubbleRing * (0.35 + vTyping * 0.36) + bubbleFill + bubbleGlint * 0.22) * (0.45 + vIntensity * 0.18);
    color = mix(color, bubbleColor, bubbleStyle);
    alpha = mix(alpha, bubbleAlpha, bubbleStyle);

    float blossomAngle = atan(uv.y, uv.x);
    float blossomRadius = length(uv);
    float leafMix = step(0.72 + uRepelRadius * 0.08, hash(vSeed + 29.0));
    float petalWave = 0.28 + 0.1 * cos(blossomAngle * 5.0 + vSeed * 0.04);
    float flowerShape = smoothstep(0.06, 0.0, abs(blossomRadius - petalWave)) * smoothstep(0.48, 0.18, blossomRadius);
    float pollen = smoothstep(0.08, 0.0, blossomRadius);
    vec2 leafUv = vec2(uv.x * 0.65, uv.y * 1.5);
    float leafShape = smoothstep(0.34, 0.0, length(leafUv - vec2(0.0, 0.04))) * smoothstep(-0.5, 0.18, uv.y);
    vec3 blossomColor = mix(uColorPrimary * (0.7 + hash(vSeed) * 0.5), uColorAccent, leafMix);
    blossomColor += uColorHighlight * pollen * (1.0 - leafMix * 0.65);
    float blossomAlpha = mix(flowerShape + pollen * 0.4, leafShape, leafMix) * (0.38 + vIntensity * 0.25);
    color = mix(color, blossomColor, blossomStyle);
    alpha = mix(alpha, blossomAlpha, blossomStyle);

    vec2 lookDir = normalize(uMouse - vTarget + vec2(0.0001));
    vec2 pupilOffset = lookDir * (0.08 + uMouseActive * 0.08) * (0.35 + vMouseMask * 0.65);
    vec2 eyeUv = vec2(uv.x * 1.36, uv.y * 0.82);
    float eyeWhite = smoothstep(0.5, 0.42, length(eyeUv));
    float iris = smoothstep(0.2 + uRepelRadius * 0.035, 0.12, length(uv - pupilOffset));
    float pupil = smoothstep(0.105, 0.052, length(uv - pupilOffset));
    float eyeLid = smoothstep(-0.45, -0.36, uv.y) * smoothstep(0.45, 0.35, uv.y);
    vec3 gazeColor = uColorPrimary * eyeWhite;
    gazeColor = mix(gazeColor, uColorAccent, iris * 0.72);
    gazeColor = mix(gazeColor, uColorHighlight, pupil);
    gazeColor += vec3(1.0) * smoothstep(0.035, 0.0, length(uv - vec2(-0.18, 0.16))) * eyeWhite * 0.55;
    float gazeAlpha = eyeWhite * eyeLid * (0.52 + vIntensity * 0.2);
    color = mix(color, gazeColor, gazeStyle);
    alpha = mix(alpha, gazeAlpha, gazeStyle);

    float flickerNoise = hash(vSeed + floor(uTime * 18.0));
    float flickerGate = mix(1.0, mix(0.36, 1.22, step(uFlicker, flickerNoise)), uFlicker);
    color *= flickerGate;
    alpha *= flickerGate;

    gl_FragColor = vec4(color, alpha);
  }
`;

const asciiParticleVertexShader = `
  attribute vec3 aTarget;
  attribute vec3 aOrigin;
  attribute float aSeed;
  attribute float aSize;
  attribute float aDelay;
  attribute float aIntensity;
  attribute float aGlyph;

  uniform float uTime;
  uniform float uProgress;
  uniform float uGlyphSize;
  uniform float uScatter;
  uniform float uTurbulence;
  uniform float uMouseForce;
  uniform float uMouseActive;
  uniform float uAttractRadius;
  uniform float uRepelRadius;
  uniform float uBreathe;
  uniform float uBirthPulse;
  uniform vec2 uMouse;

  varying vec2 vUv;
  varying float vIntensity;
  varying float vTwinkle;
  varying float vSeed;
  varying float vGlyph;
  varying float vReveal;

  float easeOutCubic(float x) {
    return 1.0 - pow(1.0 - clamp(x, 0.0, 1.0), 3.0);
  }

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec2 hash22(vec2 p) {
    return vec2(hash21(p), hash21(p + vec2(19.19))) * 2.0 - 1.0;
  }

  vec3 spectrum(float x) {
    return max(
      vec3(0.0),
      cos((vec3(x) - vec3(0.0, 0.5, 1.0)) * vec3(0.6, 1.0, 0.5) * 3.14159265)
    );
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = rotate * p * 2.03 + vec2(19.7, 7.3);
      amplitude *= 0.5;
    }

    return value;
  }

  vec2 curlNoise(vec2 p) {
    float e = 0.08;
    float n1 = fbm(p + vec2(0.0, e));
    float n2 = fbm(p - vec2(0.0, e));
    float n3 = fbm(p + vec2(e, 0.0));
    float n4 = fbm(p - vec2(e, 0.0));
    float dy = (n1 - n2) / (2.0 * e);
    float dx = (n3 - n4) / (2.0 * e);
    return vec2(dy, -dx);
  }

  void main() {
    float localProgress = easeOutCubic((uProgress - aDelay) * 1.45);
    vec3 formed = mix(aOrigin, aTarget, localProgress);
    float loose = 1.0 - localProgress;
    float driftA = aSeed * 0.015 + uTime * (0.38 + hash(aSeed) * 0.42);
    float driftB = aSeed * 0.033 - uTime * 0.3;

    formed += vec3(sin(driftA), cos(driftB), sin(driftA + driftB)) * loose * uScatter * 0.2;

    vec2 flowDomain = aTarget.xy * 1.4 + vec2(uTime * 0.16, -uTime * 0.12);
    flowDomain += vec2(hash(aSeed) * 10.0, hash(aSeed + 17.0) * 10.0);
    vec2 flow = curlNoise(flowDomain);
    float flowPulse = fbm(aTarget.xy * 2.1 + vec2(-uTime * 0.18, uTime * 0.16) + aSeed * 0.006);
    float flowMask = 0.18 + localProgress * 0.82;

    formed.xy += flow * uTurbulence * 0.09 * flowMask;
    formed.xy += flow * uBirthPulse * uTurbulence * 0.09 * localProgress;
    formed.z += (flowPulse - 0.5) * uTurbulence * 0.18;
    formed.z += sin(uTime * 1.6 + aSeed) * uTurbulence * 0.028;
    formed.xy *= 1.0 + sin(uTime * 1.32 + aSeed * 0.003) * uBreathe * localProgress;

    vec2 toMouse = aTarget.xy - uMouse;
    float mouseDistance = length(toMouse);
    vec2 mouseDirection = toMouse / max(mouseDistance, 0.001);
    vec2 mouseTangent = vec2(-mouseDirection.y, mouseDirection.x);
    float attractRadius = max(0.05, uAttractRadius);
    float repelRadius = max(0.02, uRepelRadius);
    float fieldFalloff = exp(-(mouseDistance * mouseDistance) / (attractRadius * attractRadius));
    float centerSoftener = smoothstep(repelRadius * 0.25, repelRadius, mouseDistance);
    float magneticBand = sin(mouseDistance * 4.2 - uTime * 2.1 + aSeed * 0.009);
    float mouseMask = fieldFalloff * centerSoftener * uMouseActive;
    vec2 magneticFlow = mouseTangent * (0.22 + magneticBand * 0.1);
    magneticFlow += mouseDirection * magneticBand * 0.04;
    formed.xy += magneticFlow * mouseMask * uMouseForce;
    formed.z += mouseMask * uMouseForce * (0.06 + 0.06 * magneticBand);

    float twinkle = 0.62 + 0.24 * sin(uTime * (2.5 + hash(aSeed) * 4.0) + aSeed) + flowPulse * 0.14;
    float glyphSize = uGlyphSize * (0.72 + aSize * 0.46) * (0.92 + aIntensity * 0.12);
    glyphSize *= 1.0 + uBirthPulse * 0.12 + mouseMask * 0.05;

    vec3 worldPosition = formed + vec3(position.xy * glyphSize, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);

    vUv = uv;
    vIntensity = aIntensity * (0.45 + localProgress * 0.75 + flowPulse * 0.18 + mouseMask * 0.18);
    vTwinkle = twinkle;
    vSeed = aSeed;
    vGlyph = aGlyph;
    vReveal = localProgress;
  }
`;

const asciiParticleFragmentShader = `
  precision highp float;

  uniform sampler2D uGlyphAtlas;
  uniform float uGlyphCount;
  uniform float uTime;
  uniform float uFlicker;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;
  uniform vec3 uColorHighlight;

  varying vec2 vUv;
  varying float vIntensity;
  varying float vTwinkle;
  varying float vSeed;
  varying float vGlyph;
  varying float vReveal;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    vec2 p = vUv;
    float safeGlyphCount = max(1.0, uGlyphCount);
    float glyphIndex = mod(floor(vGlyph + 0.5), safeGlyphCount);
    float glyphColumn = mod(glyphIndex, ${ASCII_ATLAS_COLUMNS.toFixed(1)});
    float glyphRow = floor(glyphIndex / ${ASCII_ATLAS_COLUMNS.toFixed(1)});
    vec2 glyphUv = (vec2(glyphColumn, glyphRow) + vec2(p.x, 1.0 - p.y)) / vec2(${ASCII_ATLAS_COLUMNS.toFixed(1)}, ${ASCII_ATLAS_ROWS.toFixed(1)});
    float glyph = texture2D(uGlyphAtlas, glyphUv).a;
    float centerFade = smoothstep(0.76, 0.28, length(p - 0.5));
    float scan = 0.86 + 0.14 * sin((p.y + vSeed * 0.017) * 46.0 - uTime * 3.8);
    float spark = hash(vSeed + floor(uTime * 18.0));
    float flickerGate = mix(1.0, mix(0.4, 1.2, step(uFlicker, spark)), uFlicker);
    float alpha = glyph * centerFade * vReveal * (0.22 + vIntensity * 0.82) * flickerGate;

    if (alpha < 0.01) {
      discard;
    }

    vec3 color = mix(uColorPrimary, uColorAccent, smoothstep(0.35, 1.25, vIntensity));
    color = mix(color, uColorHighlight, pow(max(0.0, vTwinkle), 2.0) * 0.18);
    color *= (0.56 + vIntensity * 0.9) * scan * flickerGate;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

const surfaceVertexShader = `
  precision highp float;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uStyle;
  uniform float uTurbulence;
  uniform float uBreathe;
  uniform float uPointSize;
  uniform float uMouseForce;
  uniform float uAttractRadius;
  uniform float uMotionSpeed;
  uniform float uSurfaceDepth;
  uniform float uMouseActive;
  uniform vec2 uMouse;
  uniform vec2 uVelocity;

  attribute vec3 position;
  attribute vec2 uv;

  varying vec2 vUv;
  varying float vBulge;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = rotate * p * 2.03 + vec2(11.7, 4.1);
      amplitude *= 0.5;
    }

    return value;
  }

  void main() {
    vUv = uv;
    float bulgeStyle = 1.0 - step(0.5, abs(uStyle - 9.0));
    float fluidStyle = 1.0 - step(0.5, abs(uStyle - 18.0));
    float mercuryStyle = 1.0 - step(0.5, abs(uStyle - 21.0));
    float fluidGlassStyle = 1.0 - step(0.5, abs(uStyle - 22.0));
    float shadowStyle = 1.0 - step(0.5, abs(uStyle - 23.0));
    float surfaceDepth = clamp(uSurfaceDepth, 0.0, 1.0);
    vec2 animatedFocus = vec2(
      0.5 + sin(uTime * 0.21) * 0.18,
      0.5 + cos(uTime * 0.17) * 0.16
    );
    vec2 focus = mix(animatedFocus, uMouse, 0.18 + uMouseActive * 0.82);
    focus += uVelocity * vec2(0.62, -0.52) * uMouseForce;
    focus = clamp(focus, vec2(-0.12), vec2(1.12));

    vec2 delta = uv - focus;
    float dist = length(delta);
    float radius = clamp(0.11 + uPointSize * 0.025 + uAttractRadius * 0.035, 0.14, 0.42);
    float lens = exp(-(dist * dist) / max(radius * radius, 0.0001));
    float ripple = 0.76 + 0.24 * sin(dist * 34.0 - uTime * (1.2 + uTurbulence * 0.25));
    float active = 0.36 + uMouseActive * 0.64;
    float bulge = lens * ripple * active * bulgeStyle;

    vec3 nextPosition = position;
    vec2 direction = delta / max(dist, 0.001);
    nextPosition.xy += direction * bulge * uMouseForce * 0.012 * surfaceDepth;
    nextPosition.z += bulge * (0.08 + uMouseForce * 0.065) * (0.8 + uBreathe) * surfaceDepth;

    float fluidLens = exp(-(dist * dist) / max((radius * 1.55) * (radius * 1.55), 0.0001));
    float fluidWake = 0.52 + 0.48 * sin(dist * 36.0 - uTime * (2.2 + uTurbulence * 0.2));
    nextPosition.xy += direction * fluidLens * fluidWake * fluidStyle * (0.006 + uMouseForce * 0.008) * surfaceDepth;
    nextPosition.z += fluidLens * fluidWake * fluidStyle * (0.035 + uMouseForce * 0.035) * surfaceDepth;

    float metalSheet = fbm(uv * (4.2 + uPointSize * 0.32) + vec2(uTime * 0.08, -uTime * 0.055));
    float metalWave = sin((uv.x * 3.2 - uv.y * 4.6 + metalSheet * 1.8) * 6.28318 + uTime * uMotionSpeed * 0.42);
    vec2 metalCurl = vec2(
      fbm(uv * 7.2 + vec2(uTime * 0.05, 7.1)),
      fbm(uv * 7.2 + vec2(-4.3, -uTime * 0.045))
    ) - 0.5;
    nextPosition.xy += metalCurl * mercuryStyle * surfaceDepth * (0.01 + uTurbulence * 0.006);
    nextPosition.z += mercuryStyle * surfaceDepth * (metalWave * 0.035 + metalSheet * 0.055);

    float glassSheet = fbm(uv * (3.8 + uPointSize * 0.42) + vec2(uTime * 0.055, -uTime * 0.04));
    float glassWave = sin((uv.x * 4.2 - uv.y * 3.4 + glassSheet * 2.1) * 6.28318 + uTime * uMotionSpeed * 0.38);
    vec2 glassCurl = vec2(
      fbm(uv * 6.6 + vec2(uTime * 0.035, 5.7)),
      fbm(uv * 6.6 + vec2(-3.4, -uTime * 0.04))
    ) - 0.5;
    nextPosition.xy += glassCurl * fluidGlassStyle * surfaceDepth * (0.005 + uTurbulence * 0.004);
    nextPosition.z += fluidGlassStyle * surfaceDepth * (glassWave * 0.028 + glassSheet * 0.042 + lens * 0.025 * uMouseActive);

    float shadowRadius = clamp(0.15 + uAttractRadius * 0.11 + uPointSize * 0.008, 0.16, 0.62);
    float shadowLift = exp(-(dist * dist) / max(shadowRadius * shadowRadius, 0.0001)) *
      (0.18 + uMouseActive * 0.82);
    float shadowEase = shadowLift * shadowLift * (3.0 - 2.0 * shadowLift);
    nextPosition.xy += direction * shadowEase * shadowStyle * uMouseForce * surfaceDepth * 0.01;
    nextPosition.z += shadowStyle * shadowEase * surfaceDepth * (0.12 + uMouseForce * 0.08);

    vBulge = max(
      max(max(bulge, fluidLens * fluidWake * fluidStyle * 0.5), mercuryStyle * abs(metalWave) * 0.48),
      max(
        fluidGlassStyle * (abs(glassWave) * 0.32 + glassSheet * 0.24 + lens * 0.22 * uMouseActive),
        shadowStyle * shadowEase
      )
    ) * surfaceDepth;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(nextPosition, 1.0);
  }
`;

const surfaceFragmentShader = `
  precision highp float;

  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uStyle;
  uniform float uTurbulence;
  uniform float uFlicker;
  uniform float uBreathe;
  uniform float uReveal;
  uniform float uBirthPulse;
  uniform float uPointSize;
  uniform float uMouseForce;
  uniform float uAttractRadius;
  uniform float uRepelRadius;
  uniform float uScatter;
  uniform float uMotionSpeed;
  uniform float uSurfaceDepth;
  uniform float uMouseActive;
  uniform vec2 uMouse;
  uniform vec2 uVelocity;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;
  uniform vec3 uColorHighlight;

  varying vec2 vUv;
  varying float vBulge;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec2 hash22(vec2 p) {
    return vec2(hash21(p), hash21(p + vec2(19.19))) * 2.0 - 1.0;
  }

  vec3 spectrum(float x) {
    return max(
      vec3(0.0),
      cos((vec3(x) - vec3(0.0, 0.5, 1.0)) * vec3(0.6, 1.0, 0.5) * 3.14159265)
    );
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = rotate * p * 2.02 + vec2(12.7, 4.9);
      amplitude *= 0.5;
    }

    return value;
  }

  float sampleMask(vec2 uv) {
    vec4 texel = texture2D(uMask, clamp(uv, vec2(0.0), vec2(1.0)));
    return max(texel.a, max(texel.r, max(texel.g, texel.b)));
  }

  float bayer4(vec2 cell) {
    vec2 p = mod(floor(cell), 4.0);
    float threshold = 16.0;

    if (p.x < 0.5) {
      if (p.y < 0.5) {
        threshold = 16.0;
      } else if (p.y < 1.5) {
        threshold = 5.0;
      } else if (p.y < 2.5) {
        threshold = 13.0;
      } else {
        threshold = 1.0;
      }
    } else if (p.x < 1.5) {
      if (p.y < 0.5) {
        threshold = 8.0;
      } else if (p.y < 1.5) {
        threshold = 12.0;
      } else if (p.y < 2.5) {
        threshold = 4.0;
      } else {
        threshold = 9.0;
      }
    } else if (p.x < 2.5) {
      if (p.y < 0.5) {
        threshold = 14.0;
      } else if (p.y < 1.5) {
        threshold = 2.0;
      } else if (p.y < 2.5) {
        threshold = 15.0;
      } else {
        threshold = 3.0;
      }
    } else {
      if (p.y < 0.5) {
        threshold = 6.0;
      } else if (p.y < 1.5) {
        threshold = 10.0;
      } else if (p.y < 2.5) {
        threshold = 7.0;
      } else {
        threshold = 11.0;
      }
    }

    return threshold / 17.0;
  }

  void main() {
    vec2 uv = vUv;
    vec2 center = uv - 0.5;
    float mask = sampleMask(uv);
    vec2 texel = vec2(${(1 / SURFACE_TEXTURE_SIZE).toFixed(8)});

    float left = sampleMask(uv - vec2(texel.x, 0.0));
    float right = sampleMask(uv + vec2(texel.x, 0.0));
    float down = sampleMask(uv - vec2(0.0, texel.y));
    float up = sampleMask(uv + vec2(0.0, texel.y));
    vec2 maskGradient = vec2(right - left, up - down);
    float boundary = smoothstep(0.04, 0.5, length(maskGradient));
    float body = smoothstep(0.035, 0.28, mask);

    float rippleStyle = 1.0 - step(0.5, abs(uStyle - 1.0));
    float lineStyle = 1.0 - step(0.5, abs(uStyle - 2.0));
    float chromeStyle = 1.0 - step(0.5, abs(uStyle - 4.0));
    float radianceStyle = 1.0 - step(0.5, abs(uStyle - 5.0));
    float ditherStyle = 1.0 - step(0.5, abs(uStyle - 7.0));
    float vfxStyle = 1.0 - step(0.5, abs(uStyle - 8.0));
    float bulgeStyle = 1.0 - step(0.5, abs(uStyle - 9.0));
    float gommageStyle = 1.0 - step(0.5, abs(uStyle - 10.0));
    float accessStyle = 1.0 - step(0.5, abs(uStyle - 13.0));
    float fluidStyle = 1.0 - step(0.5, abs(uStyle - 18.0));
    float glitchStyle = 1.0 - step(0.5, abs(uStyle - 20.0));
    float mercuryStyle = 1.0 - step(0.5, abs(uStyle - 21.0));
    float fluidGlassStyle = 1.0 - step(0.5, abs(uStyle - 22.0));
    float shadowStyle = 1.0 - step(0.5, abs(uStyle - 23.0));
    float surfaceDepth = clamp(uSurfaceDepth, 0.0, 1.0);

    vec2 bulgeFocus = mix(
      vec2(0.5 + sin(uTime * 0.21) * 0.18, 0.5 + cos(uTime * 0.17) * 0.16),
      uMouse,
      0.18 + uMouseActive * 0.82
    );
    bulgeFocus += uVelocity * vec2(0.62, -0.52) * uMouseForce;
    bulgeFocus = clamp(bulgeFocus, vec2(-0.12), vec2(1.12));
    vec2 bulgeDelta = uv - bulgeFocus;
    float bulgeDistance = length(bulgeDelta);
    float bulgeRadius = clamp(0.11 + uPointSize * 0.025 + uAttractRadius * 0.035, 0.14, 0.42);
    float bulgeInfluence = exp(-(bulgeDistance * bulgeDistance) / max(bulgeRadius * bulgeRadius, 0.0001));
    vec2 bulgeDirection = bulgeDelta / max(bulgeDistance, 0.001);
    float bulgeWave = 0.82 + 0.18 * sin(bulgeDistance * 31.0 - uTime * (1.2 + uTurbulence * 0.22));
    vec2 bulgeFlow = vec2(
      fbm(uv * 7.0 + vec2(uTime * 0.08, -uTime * 0.04)) - 0.5,
      fbm(uv * 7.0 + vec2(-uTime * 0.05, uTime * 0.07)) - 0.5
    ) * uTurbulence * 0.012;
    vec2 bulgeWarp = bulgeDirection * bulgeInfluence * bulgeWave * (0.014 + uMouseForce * 0.014);
    vec2 bulgeUv = uv - bulgeWarp + bulgeFlow;
    float bulgeMask = sampleMask(bulgeUv);
    float bulgeBody = smoothstep(0.025, 0.24, bulgeMask);
    float bulgeSource = smoothstep(0.025, 0.2, mask);
    float bulgeFallback = mask * body;
    float bulgeRing = smoothstep(bulgeRadius * 1.16, bulgeRadius * 0.72, bulgeDistance) *
      (1.0 - smoothstep(bulgeRadius * 0.25, bulgeRadius * 0.58, bulgeDistance));

    vec2 gommageWind = normalize(vec2(-0.92, 0.18) + uVelocity * (0.18 + uMouseForce * 0.16));
    vec2 gommagePerp = vec2(-gommageWind.y, gommageWind.x);
    float gommageScale = 2.4 + uPointSize * 1.3;
    vec2 gommageUv = uv * gommageScale +
      vec2(uTime * 0.028, -uTime * 0.016) * (0.35 + uTurbulence * 0.22);
    float gommageNoise = fbm(gommageUv);
    gommageNoise = gommageNoise * 0.68 +
      fbm(gommageUv * 2.75 + vec2(7.31, -3.72 + uTime * 0.018)) * 0.32;
    float gommageSweep = uv.x * 0.82 + (1.0 - uv.y) * 0.2 +
      (fbm(uv * (2.8 + uAttractRadius) + vec2(uTime * 0.025, -uTime * 0.018)) - 0.5) *
        (0.18 + uAttractRadius * 0.045);
    float gommageProgress = clamp(uReveal * (0.78 + uMouseForce * 0.32), 0.0, 0.84);
    float gommageThreshold = clamp(gommageProgress + (gommageSweep - 0.52) * 0.32, 0.0, 1.0);
    float gommageEdgeWidth = 0.035 + uRepelRadius * 0.065;
    float gommageKeep = smoothstep(gommageThreshold - gommageEdgeWidth, gommageThreshold + gommageEdgeWidth, gommageNoise);
    float gommageCrumbled = (1.0 - gommageKeep) * mask * body;
    float gommageEdge = exp(-abs(gommageNoise - gommageThreshold) * (20.0 - min(uRepelRadius, 1.4) * 6.0)) * mask * body;
    float gommageResidue = gommageCrumbled * (0.18 + 0.26 * fbm(uv * 48.0 + vec2(uTime * 0.04)));

    vec2 extrusionStep = vec2(texel.x * 5.4, -texel.y * 7.2);
    float sideMask = 0.0;
    float sideDepth = 0.0;
    for (int depthIndex = 1; depthIndex <= 16; depthIndex++) {
      float layer = sampleMask(uv - extrusionStep * float(depthIndex));
      sideMask = max(sideMask, layer);
      sideDepth = max(sideDepth, layer * float(depthIndex) / 16.0);
    }
    float sideBody = smoothstep(0.035, 0.24, sideMask) * (1.0 - body) * chromeStyle * surfaceDepth;

    float horizontalBeam = 0.0;
    for (int beamIndex = 1; beamIndex <= 44; beamIndex++) {
      float fi = float(beamIndex);
      float decay = exp(-fi * 0.074);
      float offset = texel.x * fi * 8.0;
      float drift = texel.y * sin(fi * 0.47) * 2.6;
      horizontalBeam += (
        sampleMask(uv - vec2(offset, drift)) +
        sampleMask(uv + vec2(offset, drift * 0.72))
      ) * decay;
    }

    float verticalBloom = 0.0;
    for (int j = 1; j <= 20; j++) {
      float fj = float(j);
      float decay = exp(-fj * 0.18);
      float offset = texel.y * fj * 5.2;
      verticalBloom += (
        sampleMask(uv - vec2(0.0, offset)) +
        sampleMask(uv + vec2(0.0, offset))
      ) * decay;
    }

    float radianceGlowBase = clamp(max(horizontalBeam * 0.085, verticalBloom * 0.12), 0.0, 1.0);

    float ditherHalo = 0.0;
    for (int k = 1; k <= 12; k++) {
      float fk = float(k);
      float decay = exp(-fk * 0.24);
      vec2 radius = vec2(texel.x * fk * 3.2, texel.y * fk * 3.2);
      ditherHalo += (
        sampleMask(uv + vec2(radius.x, 0.0)) +
        sampleMask(uv - vec2(radius.x, 0.0)) +
        sampleMask(uv + vec2(0.0, radius.y)) +
        sampleMask(uv - vec2(0.0, radius.y))
      ) * decay;
    }

    float ditherGlowBase = clamp(ditherHalo * 0.068, 0.0, 1.0);
    float vfxGlowBase = clamp(ditherHalo * 0.05 + radianceGlowBase * 0.045, 0.0, 1.0);
    float accessVelocity = length(uVelocity) * (2.8 + uMouseForce) +
      abs(sin(uTime * 0.68)) * 0.28 +
      uTurbulence * 0.18;
    vec2 accessWaveUv = uv;
    accessWaveUv.x += sin(uv.y * (5.0 + accessVelocity * 4.0) + uTime * (0.8 + uBreathe * 2.0)) *
      (0.002 + accessVelocity * 0.005 + uTurbulence * 0.0015);
    accessWaveUv.y += sin(uv.x * (18.0 + accessVelocity * 8.0) + uTime * 0.7) *
      (0.001 + accessVelocity * 0.0025);
    accessWaveUv += uVelocity * vec2(0.22, -0.18) * uMouseForce * 0.012;
    float accessMask = sampleMask(accessWaveUv);
    float accessBody = smoothstep(0.03, 0.2, accessMask);
    float accessRevealLine = 1.0 - uv.y +
      sin(uv.x * (7.0 + uScatter * 1.6) + uTime * 0.7) * (0.018 + uScatter * 0.012);
    float accessReveal = smoothstep(
      accessRevealLine - (0.035 + uPointSize * 0.006),
      accessRevealLine + (0.075 + uPointSize * 0.01),
      uReveal
    );

    vec2 fluidFocus = mix(
      vec2(0.5 + sin(uTime * 0.17) * 0.2, 0.5 + cos(uTime * 0.13) * 0.16),
      uMouse,
      0.16 + uMouseActive * 0.84
    );
    fluidFocus += uVelocity * vec2(0.74, -0.58) * uMouseForce;
    fluidFocus = clamp(fluidFocus, vec2(-0.18), vec2(1.18));
    vec2 fluidDelta = uv - fluidFocus;
    float fluidDistance = length(fluidDelta);
    float fluidRadius = clamp(0.12 + uPointSize * 0.018 + uAttractRadius * 0.055, 0.16, 0.58);
    vec2 fluidDirection = fluidDelta / max(fluidDistance, 0.001);
    vec2 fluidVelocityDirection = normalize(uVelocity + vec2(0.0001, 0.0));
    float fluidNoise = fbm(
      uv * (5.4 + uTurbulence * 1.55) +
        vec2(uTime * 0.065, -uTime * 0.045) +
        uVelocity * 1.8
    );
    float fluidFine = fbm(uv * (22.0 + uScatter * 5.0) + vec2(-uTime * 0.12, uTime * 0.09));
    float fluidCore = exp(-(fluidDistance * fluidDistance) / max(fluidRadius * fluidRadius, 0.0001));
    float fluidRingWidth = 0.035 + uRepelRadius * 0.028;
    float fluidRing = exp(
      -pow(abs(fluidDistance - fluidRadius * (0.58 + uRepelRadius * 0.12)) / max(fluidRingWidth, 0.001), 2.0)
    );
    float fluidWake = smoothstep(0.05, 0.5, dot(-fluidDirection, fluidVelocityDirection)) *
      exp(-fluidDistance / max(fluidRadius * 1.85, 0.001)) *
      length(uVelocity) *
      (1.4 + uMouseForce * 0.24);
    float fluidMask = clamp(
      fluidCore * (0.72 + fluidNoise * 0.45) +
        fluidRing * (0.2 + uRepelRadius * 0.2) +
        fluidWake,
      0.0,
      1.0
    );
    float fluidReveal = smoothstep(
      0.16,
      0.78,
      fluidMask + (fluidNoise - 0.5) * (0.18 + uTurbulence * 0.035)
    );
    float fluidWire = smoothstep(0.06, 0.48, boundary + fluidFine * 0.12) *
      (1.0 - fluidReveal * (0.26 + uScatter * 0.12));
    float fluidBody = mask * body;
    float fluidGlowBase = clamp(
      ditherHalo * 0.04 +
        radianceGlowBase * 0.026 +
        fluidCore * 0.075 +
        fluidRing * 0.06,
      0.0,
      1.0
    );

    vec2 fluidGlassFocus = mix(
      vec2(0.52 + sin(uTime * 0.12) * 0.18, 0.48 + cos(uTime * 0.1) * 0.14),
      uMouse,
      0.14 + uMouseActive * 0.86
    );
    vec2 fluidGlassDelta = uv - fluidGlassFocus;
    float fluidGlassDistance = length(fluidGlassDelta);
    vec2 fluidGlassDirection = fluidGlassDelta / max(fluidGlassDistance, 0.001);
    float fluidGlassRadius = clamp(0.18 + uAttractRadius * 0.09, 0.2, 0.62);
    float fluidGlassLens = exp(
      -(fluidGlassDistance * fluidGlassDistance) / max(fluidGlassRadius * fluidGlassRadius, 0.0001)
    );
    vec2 fluidGlassSpin = vec2(-fluidGlassDirection.y, fluidGlassDirection.x) *
      fluidGlassLens *
      (0.008 + uMouseForce * 0.012) *
      (0.38 + uMouseActive * 0.62);
    vec2 fluidGlassDomain = uv +
      fluidGlassSpin +
      uVelocity * vec2(0.22, -0.16) * uMouseForce * 0.026;
    float fluidGlassCell = fbm(
      fluidGlassDomain * (4.6 + uPointSize * 0.58) +
        vec2(uTime * 0.052, -uTime * 0.038) +
        fluidGlassSpin * 24.0
    );
    float fluidGlassFine = fbm(
      fluidGlassDomain * (14.0 + uScatter * 4.4) +
        vec2(-uTime * 0.105, uTime * 0.078)
    );
    vec2 fluidGlassWarp = vec2(
      fluidGlassCell - 0.5,
      fluidGlassFine - 0.5
    ) * (0.026 + uTurbulence * 0.008) + fluidGlassSpin * 0.86;
    vec2 fluidGlassUv = uv + fluidGlassWarp;
    float fluidGlassMask = sampleMask(fluidGlassUv);
    float fluidGlassBody = smoothstep(0.025, 0.2, fluidGlassMask);
    float fluidGlassLeft = sampleMask(fluidGlassUv - vec2(texel.x * 1.8, 0.0));
    float fluidGlassRight = sampleMask(fluidGlassUv + vec2(texel.x * 1.8, 0.0));
    float fluidGlassDown = sampleMask(fluidGlassUv - vec2(0.0, texel.y * 1.8));
    float fluidGlassUp = sampleMask(fluidGlassUv + vec2(0.0, texel.y * 1.8));
    vec2 fluidGlassGradient = vec2(fluidGlassRight - fluidGlassLeft, fluidGlassUp - fluidGlassDown);
    float fluidGlassEdge = smoothstep(0.045, 0.46, length(fluidGlassGradient));
    float fluidGlassReaction = smoothstep(
      0.36,
      0.82,
      abs(sin((fluidGlassCell * 4.3 + fluidGlassFine * 1.7 + fluidGlassMask * 2.2 + uTime * uMotionSpeed * 0.32) * 3.14159))
    );
    float fluidGlassCaustic = pow(smoothstep(0.54, 1.0, fluidGlassReaction), 2.0) * fluidGlassBody;
    float fluidGlassGlowBase = clamp(
      fluidGlassEdge * (0.22 + uRepelRadius * 0.14) +
        fluidGlassCaustic * (0.18 + uScatter * 0.1) +
        fluidGlassLens * uMouseActive * 0.07,
      0.0,
      1.0
    );

    vec2 shadowFocus = mix(
      vec2(0.5 + sin(uTime * 0.13) * 0.12, 0.5 + cos(uTime * 0.1) * 0.1),
      uMouse,
      0.12 + uMouseActive * 0.88
    );
    vec2 shadowDelta = uv - shadowFocus;
    float shadowDistance = length(shadowDelta);
    float shadowRadius = clamp(0.16 + uAttractRadius * 0.12 + uPointSize * 0.01, 0.18, 0.7);
    float shadowLift = exp(-(shadowDistance * shadowDistance) / max(shadowRadius * shadowRadius, 0.0001)) *
      (0.18 + uMouseActive * 0.82);
    float shadowEase = shadowLift * shadowLift * (3.0 - 2.0 * shadowLift);
    vec2 shadowOffset = vec2(0.022 + uScatter * 0.026, -0.035 - uScatter * 0.028);
    vec2 shadowUv = uv - shadowOffset * (0.72 + surfaceDepth * 0.42);
    float shadowBlur =
      sampleMask(shadowUv) * 0.3 +
      sampleMask(shadowUv + vec2(texel.x * 4.5, 0.0)) * 0.12 +
      sampleMask(shadowUv - vec2(texel.x * 4.5, 0.0)) * 0.12 +
      sampleMask(shadowUv + vec2(0.0, texel.y * 4.5)) * 0.12 +
      sampleMask(shadowUv - vec2(0.0, texel.y * 4.5)) * 0.12 +
      sampleMask(shadowUv + texel * vec2(3.2, 3.2)) * 0.08 +
      sampleMask(shadowUv - texel * vec2(3.2, 3.2)) * 0.08 +
      sampleMask(shadowUv + texel * vec2(3.2, -3.2)) * 0.08 +
      sampleMask(shadowUv + texel * vec2(-3.2, 3.2)) * 0.08;
    float shadowDrop = smoothstep(0.018, 0.38 + uRepelRadius * 0.16, shadowBlur);
    float shadowHole = mix(
      1.0,
      smoothstep(0.04, shadowRadius * (0.88 + uMouseForce * 0.08), shadowDistance),
      clamp(uMouseActive * (0.48 + uMouseForce * 0.18), 0.0, 0.92)
    );
    float shadowBody = mask * body;
    float shadowPaper = fbm(uv * (18.0 + uTurbulence * 22.0) + vec2(uTime * 0.02, -uTime * 0.017));
    float shadowRim = smoothstep(0.06, 0.46, length(maskGradient)) * shadowBody;
    float shadowDropAlpha = shadowDrop * shadowHole * (0.14 + uFlicker * 0.28) * (1.0 - shadowBody * 0.34);

    float glitchSpeed = 0.6 + uMotionSpeed * 1.25;
    float glitchRows = 18.0 + floor(uScatter * 22.0);
    float glitchRow = floor(uv.y * glitchRows + uTime * glitchSpeed * 2.0);
    float glitchRowNoise = hash21(vec2(glitchRow, floor(uTime * (8.0 + uMotionSpeed * 7.0))));
    float glitchGate = step(0.72 - uFlicker * 0.5, glitchRowNoise) * (0.22 + uFlicker * 0.9);
    float glitchMouse = exp(-length(uv - uMouse) / max(0.18, uAttractRadius * 0.22)) * uMouseActive * uMouseForce * 0.32;
    float glitchOffset = (glitchRowNoise - 0.5) *
      (0.012 + uRepelRadius * 0.018 + uTurbulence * 0.006) *
      (glitchGate + glitchMouse);
    vec2 glitchUv = uv + vec2(glitchOffset, 0.0);
    glitchUv.y += sin(uv.x * (18.0 + uScatter * 10.0) + uTime * glitchSpeed) * uTurbulence * 0.002;
    float glitchMask = sampleMask(glitchUv);
    float glitchInk = smoothstep(0.025, 0.18, glitchMask);
    float glitchRevealLine = uv.x * 0.72 + (1.0 - uv.y) * 0.18 +
      sin(uv.y * 7.0 + uTime * 0.85) * (0.02 + uTurbulence * 0.006);
    float glitchReveal = smoothstep(glitchRevealLine - 0.11, glitchRevealLine + 0.18, uReveal);
    float glitchShift = 0.003 + uRepelRadius * 0.008 + glitchGate * 0.012 + glitchMouse * 0.01;
    float glitchRed = sampleMask(glitchUv + vec2(glitchShift, 0.0));
    float glitchGreen = glitchMask;
    float glitchBlue = sampleMask(glitchUv - vec2(glitchShift * 1.15, 0.0));
    float glitchScan = 0.82 + 0.18 * sin(uv.y * ${SURFACE_TEXTURE_SIZE.toFixed(1)} * (0.24 + uPointSize * 0.02) - uTime * 4.2);
    float glitchBlock = step(
      0.88 - uFlicker * 0.24,
      hash21(floor(uv * vec2(18.0 + uScatter * 8.0, 10.0 + uPointSize * 1.2)) + vec2(floor(uTime * glitchSpeed * 6.0)))
    ) * glitchGate;
    float glitchEdge = smoothstep(0.06, 0.5, length(maskGradient)) * glitchInk;
    float glitchGlowBase = clamp(
      glitchInk * (0.08 + glitchGate * 0.18 + glitchMouse * 0.12) +
        glitchEdge * 0.2 +
        glitchBlock * 0.16,
      0.0,
      1.0
    );
    float gommageDust = 0.0;
    for (int dustIndex = 1; dustIndex <= 38; dustIndex++) {
      float fi = float(dustIndex);
      float decay = exp(-fi * (0.062 + uScatter * 0.012));
      float wander = (hash21(vec2(fi * 11.17, floor(uTime * 10.0))) - 0.5) * fi * texel.y * 3.6;
      vec2 sampleUv = uv - gommageWind * texel * fi * (6.0 + uScatter * 9.0) +
        gommagePerp * wander;
      float dustSample = sampleMask(sampleUv);
      float dustNoise = fbm(sampleUv * (18.0 + uTurbulence * 7.0) + vec2(fi * 0.13, uTime * 0.055));
      gommageDust += dustSample * decay * smoothstep(gommageThreshold - 0.18, gommageThreshold + 0.18, dustNoise);
    }
    gommageDust = clamp(gommageDust * 0.1 * (0.72 + uScatter * 0.34), 0.0, 1.0);
    float visibleMask = max(
      max(max(mask, sideMask * chromeStyle), radianceGlowBase * radianceStyle),
      max(
        max(ditherGlowBase * ditherStyle, max(vfxGlowBase, 0.02) * vfxStyle),
        max(
          (max(max(bulgeBody, bulgeSource), bulgeFallback) + bulgeRing * 0.24 + bulgeInfluence * 0.035) * bulgeStyle,
          max(
            (mask * body * gommageKeep + gommageResidue + gommageEdge * 0.45 + gommageDust * 0.72) * gommageStyle,
            max(
              (accessMask * accessBody * accessReveal + boundary * 0.18 * accessReveal) * accessStyle,
              (glitchInk * glitchReveal + glitchGlowBase * 0.55 + glitchBlock * 0.28) * glitchStyle
            )
          )
        )
      )
    );
    visibleMask = max(
      visibleMask,
      (fluidBody * (0.36 + fluidReveal * 0.72) + fluidWire * mask * 0.34 + fluidGlowBase * 0.22) *
        fluidStyle
    );
    visibleMask = max(
      visibleMask,
      (fluidGlassBody * (0.42 + fluidGlassReaction * 0.34) + fluidGlassGlowBase * 0.28) *
        fluidGlassStyle
    );
    visibleMask = max(
      visibleMask,
      (shadowBody + shadowDropAlpha * 0.92 + shadowRim * 0.24) * shadowStyle
    );
    visibleMask = max(visibleMask, mercuryStyle);
    if (visibleMask < 0.012) {
      discard;
    }

    float flow = fbm(uv * (3.4 + uTurbulence * 0.7) + vec2(uTime * 0.08, -uTime * 0.06));
    float fineFlow = fbm(uv * 12.0 + vec2(-uTime * 0.18, uTime * 0.12));
    float breathe = 1.0 + sin(uTime * 1.45 + flow * 4.0) * uBreathe;
    float revealLine = uv.x * 0.78 + (1.0 - uv.y) * 0.18 + flow * 0.12 + (fineFlow - 0.5) * 0.07;
    float revealDelta = uReveal - revealLine;
    float reveal = smoothstep(-0.12, 0.2, revealDelta);
    float birthGlow = smoothstep(0.2, 0.0, abs(revealDelta)) * uBirthPulse;

    float dist = length(center);
    float rippleCore = 0.5 + 0.5 * sin((dist * 34.0 + flow * 5.5) - uTime * 2.4);
    float rippleSoft = smoothstep(0.48, 0.92, rippleCore);
    float rippleDepth = smoothstep(0.15, 0.95, fineFlow);
    vec3 rippleColor = mix(uColorPrimary * 0.04, uColorAccent * 0.48, rippleSoft);
    rippleColor = mix(rippleColor, uColorPrimary * 0.9, rippleDepth * 0.28 + birthGlow * 0.32);
    rippleColor += uColorHighlight * rippleSoft * rippleDepth * 0.38;
    rippleColor *= 0.55 + body * 0.85;

    float lineDomain = (uv.x * 0.85 + uv.y * 1.55 + flow * 0.1 - uTime * 0.04) * 42.0;
    float lineStripes = smoothstep(0.16, 0.0, abs(fract(lineDomain) - 0.5));
    float lineWash = fbm(vec2(uv.x * 3.2 - uv.y * 0.8, uv.y * 2.6 + uTime * 0.04));
    vec3 lineColor = mix(uColorPrimary * 0.08, uColorPrimary * 0.72, lineStripes * 0.78);
    lineColor = mix(lineColor, uColorAccent * 0.55, lineWash * 0.34);
    lineColor += uColorHighlight * pow(lineStripes, 4.0) * 0.42;
    lineColor *= 0.58 + body * 0.72 + birthGlow * 0.22;

    vec2 chromeUv = uv + vec2((fineFlow - 0.5) * 0.045, (flow - 0.5) * 0.035) * (0.8 + uTurbulence);
    vec3 topNormal = normalize(vec3(-maskGradient * 5.2, 0.82));
    vec3 lightDir = normalize(vec3(-0.45, 0.58, 0.68));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float diffuse = clamp(dot(topNormal, lightDir) * 0.5 + 0.5, 0.0, 1.0);
    float specular = pow(max(dot(reflect(-lightDir, topNormal), viewDir), 0.0), 42.0);
    float broadBand = 0.5 + 0.5 * sin((chromeUv.x * 1.35 - chromeUv.y * 2.45 + flow * 0.42) * 6.28318 - 0.45);
    float brushBand = 0.5 + 0.5 * sin((chromeUv.x * 6.0 + chromeUv.y * 1.6 + fineFlow * 0.7) * 3.14159);
    float brushed = mix(broadBand, brushBand, 0.22);
    float bevel = smoothstep(0.1, 0.72, boundary) * body;
    float innerPlate = smoothstep(0.18, 0.72, body) * (1.0 - bevel * 0.18);
    vec3 silverDark = uColorPrimary * 0.24;
    vec3 silverMid = mix(uColorPrimary * 0.58, uColorAccent * 0.42, 0.35);
    vec3 silverBright = mix(uColorPrimary, uColorHighlight, 0.78);
    vec3 chromeTop = mix(silverDark, silverMid, smoothstep(0.18, 0.95, brushed));
    chromeTop = mix(chromeTop, silverBright, specular * 0.9 + bevel * 0.32 + birthGlow * 0.28);
    chromeTop *= 0.62 + diffuse * 0.52 + innerPlate * 0.1;
    chromeTop += silverBright * pow(smoothstep(0.58, 1.0, brushed), 5.0) * 0.35;

    float sideSheen = 0.5 + 0.5 * sin((uv.x * 3.0 + uv.y * 8.0 + sideDepth * 4.5) * 3.14159);
    vec3 sideMetal = mix(uColorPrimary * 0.1, uColorPrimary * 0.65, sideSheen * 0.56 + sideDepth * 0.24);
    sideMetal *= 0.46 + sideDepth * 0.42;
    sideMetal += uColorHighlight * smoothstep(0.72, 1.0, sideSheen) * 0.16;
    float chromeIridescence = fbm(chromeUv * (2.2 + uScatter * 1.25) + vec2(uTime * (0.08 + uMotionSpeed * 0.08)));
    float chromeStripeA = 0.5 + 0.5 * sin((chromeUv.x * 2.3 - chromeUv.y * 1.35 + chromeIridescence * 0.76) * 6.28318 + uTime * uMotionSpeed * 0.42);
    float chromeStripeB = 0.5 + 0.5 * sin((chromeUv.x * -1.15 + chromeUv.y * 3.05 + fineFlow * 0.72) * 6.28318 - uTime * 0.28);
    float chromeHot = pow(smoothstep(0.62, 1.0, chromeStripeA), 2.4);
    float chromeBlue = pow(smoothstep(0.46, 1.0, chromeStripeB), 2.1);
    float chromeShadow = smoothstep(0.2, 0.86, 1.0 - brushed);
    vec3 chromePrism = uColorPrimary * 0.015;
    chromePrism = mix(chromePrism, uColorPrimary * 0.56, innerPlate * (0.32 + chromeShadow * 0.42));
    chromePrism += uColorAccent * chromeBlue * (0.5 + uFlicker * 0.52);
    chromePrism += uColorHighlight * chromeHot * (0.48 + uMouseForce * 0.12);
    chromePrism += spectrum(chromeStripeA + chromeIridescence * 0.18) * uFlicker * 0.2 * body;
    chromePrism += vec3(1.0) * pow(specular, 1.35) * (0.2 + uMouseForce * 0.22);
    chromePrism += uColorAccent * bevel * boundary * (0.12 + uAttractRadius * 0.08);
    chromePrism *= 0.48 + diffuse * 0.62 + innerPlate * 0.22;
    vec3 chromeBase = mix(chromePrism, chromeTop, 0.1 + surfaceDepth * 0.24);
    chromeBase = mix(chromeBase, sideMetal, sideBody);

    float beamFlow = fbm(vec2(uv.x * 1.9 - uTime * 0.045, uv.y * 7.0 + uTime * 0.025));
    float beamBands = 0.72 + 0.28 * sin((uv.x * 7.0 + beamFlow * 2.5) - uTime * 0.75);
    float radianceGlow = clamp(radianceGlowBase * (0.82 + beamFlow * 0.28) * beamBands, 0.0, 1.0);
    float hotCore = smoothstep(0.04, 0.7, mask) * body;
    float redPlate = smoothstep(0.05, 0.42, mask) * (0.9 + birthGlow * 0.16);
    vec3 radianceCore = mix(uColorPrimary * 0.28, uColorPrimary, redPlate);
    radianceCore += uColorHighlight * hotCore * (0.26 + birthGlow * 0.42);
    vec3 radianceBeam = uColorAccent * pow(radianceGlow, 0.72);
    radianceBeam += uColorPrimary * radianceGlow * 0.52;
    vec3 radianceColor = radianceCore * hotCore + radianceBeam;

    float ditherCellSize = clamp(2.8 + uPointSize * 1.25, 3.5, 14.0);
    vec2 ditherFrag = uv * ${SURFACE_TEXTURE_SIZE.toFixed(1)};
    vec2 ditherCell = floor(ditherFrag / ditherCellSize);
    vec2 ditherUv = (ditherCell + 0.5) * ditherCellSize / ${SURFACE_TEXTURE_SIZE.toFixed(1)};
    float ditherMask = sampleMask(ditherUv);
    float ditherNoise = fbm(ditherCell * 0.13 + vec2(uTime * 0.08, -uTime * 0.05));
    float ditherBrightness = clamp(
      ditherMask * (1.08 + birthGlow * 0.18) +
      ditherGlowBase * 0.42 +
      (ditherNoise - 0.5) * (0.16 + uTurbulence * 0.04),
      0.0,
      1.0
    );
    float ditherOn = step(bayer4(ditherCell), ditherBrightness);
    vec2 ditherLocal = fract(ditherFrag / ditherCellSize);
    float ditherCellShape =
      smoothstep(0.04, 0.16, ditherLocal.x) *
      smoothstep(0.04, 0.16, ditherLocal.y) *
      smoothstep(0.04, 0.16, 1.0 - ditherLocal.x) *
      smoothstep(0.04, 0.16, 1.0 - ditherLocal.y);
    float ditherTone = ditherOn * ditherCellShape * smoothstep(0.025, 0.12, ditherBrightness);
    float ditherChroma = fbm(ditherUv * 6.0 + vec2(uTime * 0.035, -uTime * 0.025));
    vec3 ditherInk = mix(uColorPrimary * 0.82, uColorAccent * 0.92, ditherChroma * 0.42 + boundary * 0.28);
    ditherInk = mix(ditherInk, uColorHighlight, pow(ditherBrightness, 3.0) * 0.16);
    vec3 ditherColor = vec3(0.002, 0.003, 0.004) * max(ditherBrightness, ditherGlowBase);
    ditherColor += ditherInk * ditherTone * (0.84 + birthGlow * 0.28);

    vec2 vfxLight = mix(
      vec2(0.5 + sin(uTime * 0.23) * 0.18, 0.52 + cos(uTime * 0.19) * 0.16),
      uMouse,
      0.22 + uMouseActive * 0.78
    );
    vfxLight += uVelocity * vec2(1.0, -1.0) * uMouseForce * 0.46;
    vfxLight = clamp(vfxLight, vec2(-0.18), vec2(1.18));

    float vfxRay = 0.0;
    float vfxReach = clamp(0.28 + uScatter * 0.36, 0.22, 1.08);
    vec2 vfxDirection = vfxLight - uv;

    for (int sampleIndex = 0; sampleIndex < 64; sampleIndex++) {
      float sampleStep = (float(sampleIndex) + 0.5) / 64.0;
      vec2 sampleUv = uv + vfxDirection * sampleStep * vfxReach;
      sampleUv += hash22(sampleUv * 92.0 + vec2(float(sampleIndex), uTime * 0.7)) *
        (0.0008 + uTurbulence * 0.0016);
      vfxRay += sampleMask(sampleUv) / 64.0;
    }

    vec2 vfxLightDelta = uv - vfxLight;
    float vfxDist = length(vfxLightDelta);
    float vfxLightSize = 0.028 + uPointSize * 0.014;
    float vfxLamp = pow(vfxLightSize / max(vfxDist, 0.025), 0.44);
    float vfxSource = smoothstep(0.025, 0.2, mask);
    float vfxEdge = smoothstep(0.06, 0.56, length(maskGradient));
    float vfxOutside = 1.0 - smoothstep(0.015, 0.12, mask);
    float vfxShadow = smoothstep(0.03, 0.64, vfxRay) * (0.56 + uRepelRadius * 0.7);
    float vfxPulse = 1.0 + sin(uTime * (0.85 + uMouseForce * 0.12) + flow * 3.0) * uBreathe;
    vec3 vfxRainbow = spectrum(cos(vfxRay * 3.5 + vfxDist * 1.7 + uTime * 0.08));
    vec3 vfxCore = uColorPrimary * vfxSource * (1.62 + birthGlow * 0.45);
    vfxCore += vec3(1.0) * pow(vfxSource, 2.2) * 0.36;
    vfxCore += uColorHighlight * vfxEdge * vfxSource * (0.48 + uMouseForce * 0.05);
    vec3 vfxColor = vec3(vfxLamp * 0.11) * vfxOutside;
    vfxColor -= vec3(vfxShadow * 0.18) * vfxOutside;
    vfxColor += vfxRainbow * vfxRay * vfxOutside * (1.1 + uMouseForce * 0.42);
    vfxColor += uColorAccent * vfxGlowBase * 0.12 + vfxCore;
    float vfxGrain = (hash21(uv * ${SURFACE_TEXTURE_SIZE.toFixed(1)} + vec2(floor(uTime * 16.0))) - 0.5) *
      0.035 * uFlicker;
    vfxColor = max(vec3(0.0), vfxColor - vec3(vfxGrain));
    vfxColor *= vfxPulse;

    vec2 bulgeChromaShift = bulgeDirection * (0.002 + uRepelRadius * 0.006 + vBulge * 0.01);
    float bulgeRed = sampleMask(bulgeUv - bulgeChromaShift * (1.0 + uMouseForce * 0.18));
    float bulgeGreen = bulgeMask;
    float bulgeBlue = sampleMask(bulgeUv + bulgeChromaShift * (1.0 + uMouseForce * 0.18));
    vec3 bulgeNormal = normalize(vec3(
      -(maskGradient + bulgeDirection * (bulgeInfluence + vBulge) * 0.28) * (3.6 + uScatter * 1.2),
      0.92
    ));
    vec3 bulgeLight = normalize(vec3(-0.42, 0.58, 0.72));
    float bulgeDiffuse = clamp(dot(bulgeNormal, bulgeLight) * 0.5 + 0.5, 0.0, 1.0);
    float bulgeSpec = pow(max(dot(reflect(-bulgeLight, bulgeNormal), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    float bulgeCaustic = pow(max(0.0, 1.0 - abs(bulgeDistance - bulgeRadius * 0.58) / max(bulgeRadius * 0.34, 0.001)), 2.2);
    float bulgeTexture = fbm(bulgeUv * 12.0 + vec2(uTime * 0.055, -uTime * 0.035));
    vec3 bulgeChroma = vec3(bulgeRed, bulgeGreen, bulgeBlue);
    vec3 bulgeFace = mix(uColorPrimary * 0.58, uColorPrimary * 1.24, bulgeDiffuse);
    bulgeFace += vec3(1.0) * pow(bulgeBody, 2.8) * 0.22;
    vec3 bulgeColor = uColorPrimary * bulgeSource * (0.92 + bulgeDiffuse * 0.26);
    bulgeColor += uColorPrimary * bulgeFallback * (0.98 + bulgeDiffuse * 0.32 + birthGlow * 0.22);
    bulgeColor += bulgeFace * bulgeChroma * bulgeBody * (0.72 + bulgeTexture * 0.22);
    bulgeColor += uColorAccent * boundary * max(bulgeFallback, bulgeSource) * 0.18;
    bulgeColor += uColorAccent * bulgeRing * (0.16 + uScatter * 0.08);
    bulgeColor += uColorHighlight * (bulgeSpec * (0.75 + uMouseForce * 0.2) + bulgeCaustic * 0.12) * (0.3 + max(bulgeBody, bulgeSource));
    bulgeColor += vec3(0.02, 0.025, 0.028) * bulgeInfluence * (1.0 - bulgeBody);
    bulgeColor = max(vec3(0.0), bulgeColor - vec3((hash21(uv * 420.0 + vec2(floor(uTime * 12.0))) - 0.5) * uFlicker * 0.025));
    bulgeColor *= 1.0 + vBulge * 0.28;

    float gommageSpeckle = hash21(floor(uv * ${SURFACE_TEXTURE_SIZE.toFixed(1)} / 2.4) + vec2(floor(uTime * 12.0)));
    float gommageAshGrain = mix(0.7, 1.18, gommageSpeckle);
    vec3 gommageBase = mix(uColorPrimary, mix(uColorAccent, uColorPrimary, 0.22), smoothstep(0.08, 0.62, gommageProgress));
    vec3 gommagePowder = mix(uColorAccent * 0.82, uColorPrimary * 0.62, fbm(uv * 22.0 + vec2(uTime * 0.035)));
    vec3 gommageColor = gommageBase * mask * body * gommageKeep * (0.92 + fineFlow * 0.22);
    gommageColor += gommagePowder * gommageResidue * (1.05 + uTurbulence * 0.14);
    gommageColor += uColorHighlight * gommageEdge * (0.9 + birthGlow * 0.36 + uRepelRadius * 0.22);
    gommageColor += uColorAccent * gommageDust * (0.72 + uScatter * 0.16);
    gommageColor += vec3(1.0) * pow(gommageEdge, 3.0) * 0.28;
    gommageColor *= mix(1.0, gommageAshGrain, uFlicker * 0.6);

    vec2 accessShift = vec2(
      0.0025 + uRepelRadius * 0.004 + accessVelocity * 0.003,
      0.001 + accessVelocity * 0.002
    );
    float accessRed = sampleMask(accessWaveUv + accessShift * vec2(0.9, 0.45));
    float accessGreen = accessMask;
    float accessBlue = sampleMask(accessWaveUv - accessShift * vec2(1.1, 0.72));
    float accessInk = smoothstep(0.025, 0.18, accessMask) * accessReveal;
    float accessEdge = smoothstep(0.05, 0.45, length(maskGradient)) * accessReveal;
    float accessScan = 0.92 + 0.08 * sin(uv.y * ${SURFACE_TEXTURE_SIZE.toFixed(1)} * 0.32 - uTime * 3.4);
    float accessSlice = smoothstep(0.014, 0.0, abs(fract((uv.y + uTime * 0.022) * (28.0 + uScatter * 8.0)) - 0.5));
    vec3 accessColor = uColorPrimary * accessGreen * (1.05 + birthGlow * 0.2);
    accessColor += uColorHighlight * max(0.0, accessRed - accessGreen * 0.72) * (1.8 + uRepelRadius * 0.45);
    accessColor += uColorAccent * max(0.0, accessBlue - accessGreen * 0.66) * (1.5 + accessVelocity * 0.25);
    accessColor += uColorAccent * accessEdge * (0.22 + accessVelocity * 0.08);
    accessColor += vec3(1.0) * accessSlice * accessInk * 0.08;
    accessColor *= accessScan;

    vec3 glitchColor = uColorPrimary * glitchGreen * (0.86 + glitchReveal * 0.26);
    glitchColor += uColorHighlight * max(0.0, glitchRed - glitchGreen * 0.62) * (1.4 + uRepelRadius * 0.7);
    glitchColor += uColorAccent * max(0.0, glitchBlue - glitchGreen * 0.62) * (1.35 + uTurbulence * 0.25);
    glitchColor += uColorAccent * glitchEdge * (0.22 + glitchGate * 0.42);
    glitchColor += uColorHighlight * glitchBlock * glitchInk * 0.2;
    glitchColor *= glitchScan * glitchReveal;

    vec2 fluidWarp = vec2(
      fbm(uv * 9.5 + vec2(uTime * 0.11, -uTime * 0.07)),
      fbm(uv * 9.5 + vec2(-uTime * 0.08, uTime * 0.1))
    ) - 0.5;
    vec2 fluidUv = uv +
      fluidWarp * (0.008 + uTurbulence * 0.006) +
      uVelocity * vec2(0.18, -0.14) * uMouseForce * 0.02;
    float fluidShiftMask = sampleMask(fluidUv);
    float fluidSource = smoothstep(0.025, 0.18, fluidShiftMask);
    float fluidEdge = smoothstep(0.05, 0.52, length(maskGradient));
    float fluidScan = 0.9 + 0.1 * sin(uv.y * ${SURFACE_TEXTURE_SIZE.toFixed(1)} * 0.44 - uTime * 4.8);
    float fluidCrtLine = smoothstep(0.02, 0.0, abs(fract((uv.y + uTime * 0.018) * (56.0 + uScatter * 12.0)) - 0.5));
    float fluidGrain = hash21(uv * ${SURFACE_TEXTURE_SIZE.toFixed(1)} + vec2(floor(uTime * 22.0)));
    vec3 fluidCold = mix(uColorPrimary * 0.04, uColorAccent * 0.12, 0.62);
    vec3 fluidWireColor = uColorAccent * fluidWire * fluidBody * (0.42 + fluidFine * 0.42);
    vec3 fluidSolid = mix(fluidCold, uColorPrimary * (1.08 + birthGlow * 0.18), fluidReveal);
    fluidSolid += uColorHighlight * fluidEdge * fluidReveal * (0.34 + fluidRing * 0.9);
    fluidSolid += uColorAccent * fluidRing * fluidBody * (0.32 + uMouseForce * 0.08);
    vec3 fluidColor = fluidSolid * fluidSource * (0.62 + fluidReveal * 0.52);
    fluidColor += fluidWireColor * (0.8 + uScatter * 0.28);
    fluidColor += uColorAccent * fluidGlowBase * (0.16 + fluidReveal * 0.18);
    fluidColor += uColorHighlight * fluidCrtLine * fluidBody * fluidReveal * 0.06;
    fluidColor = mix(vec3(dot(fluidColor, vec3(0.299, 0.587, 0.114))) * 0.72, fluidColor, 0.92);
    fluidColor *= fluidScan * (0.94 + uBreathe * 0.9 * sin(uTime * 1.2 + fluidNoise * 5.0));
    fluidColor = max(vec3(0.0), fluidColor - vec3((fluidGrain - 0.5) * uFlicker * 0.04));

    vec2 mercuryFocus = mix(
      vec2(0.48 + sin(uTime * 0.14) * 0.16, 0.52 + cos(uTime * 0.11) * 0.14),
      uMouse,
      0.2 + uMouseActive * 0.8
    );
    vec2 mercuryDelta = uv - mercuryFocus;
    float mercuryDistance = length(mercuryDelta);
    float mercuryVortex = exp(-mercuryDistance / max(0.16, 0.34 + uAttractRadius * 0.08));
    vec2 mercurySpin = vec2(-mercuryDelta.y, mercuryDelta.x) *
      mercuryVortex *
      (0.024 + uMouseForce * 0.014) *
      (0.4 + uMouseActive * 0.6);
    vec2 mercuryDomain = uv;
    mercuryDomain += vec2(flow - 0.5, fineFlow - 0.5) * (0.048 + uTurbulence * 0.014);
    mercuryDomain += mercurySpin;

    float mercuryFlow = fbm(mercuryDomain * (2.1 + uScatter * 0.72) + vec2(uTime * 0.05, -uTime * 0.035));
    float mercuryFine = noise(mercuryDomain * (13.0 + uPointSize * 0.8) + vec2(-uTime * 0.16, uTime * 0.11));
    vec2 mercuryWarp = vec2(
      sin(mercuryDomain.y * 8.4 + mercuryFlow * 5.2 + uTime * 0.24),
      cos(mercuryDomain.x * 7.2 - mercuryFlow * 4.3 - uTime * 0.18)
    ) * 0.5 + vec2(mercuryFlow - 0.5, mercuryFine - 0.5) * 0.4;
    vec2 mercuryUv = uv + mercuryWarp * (0.022 + uTurbulence * 0.011) + mercurySpin * 0.72;
    float mercuryMask = sampleMask(mercuryUv);
    float mercuryBody = smoothstep(0.025, 0.22, mercuryMask);
    float mercuryLeft = sampleMask(mercuryUv - vec2(texel.x * 2.2, 0.0));
    float mercuryRight = sampleMask(mercuryUv + vec2(texel.x * 2.2, 0.0));
    float mercuryDown = sampleMask(mercuryUv - vec2(0.0, texel.y * 2.2));
    float mercuryUp = sampleMask(mercuryUv + vec2(0.0, texel.y * 2.2));
    vec2 mercuryGradient = vec2(mercuryRight - mercuryLeft, mercuryUp - mercuryDown);
    float mercuryEdge = smoothstep(0.04, 0.42, length(mercuryGradient));
    float mercuryHeight =
      mercuryBody * (0.62 + surfaceDepth * 0.74) +
      mercuryFlow * (0.16 + uTurbulence * 0.035) +
      mercuryFine * 0.07 +
      mercuryVortex * uMouseActive * 0.12;
    vec3 mercuryNormal = normalize(vec3(
      -(mercuryGradient * (5.8 + uAttractRadius * 2.2) + mercuryWarp * (0.45 + uTurbulence * 0.12)) * surfaceDepth,
      0.76
    ));
    vec3 mercuryLightA = normalize(vec3(-0.48, 0.62, 0.74));
    vec3 mercuryLightB = normalize(vec3(0.72, -0.28, 0.54));
    float mercuryDiffuse = clamp(dot(mercuryNormal, mercuryLightA) * 0.5 + 0.5, 0.0, 1.0);
    float mercurySpecA = pow(max(dot(reflect(-mercuryLightA, mercuryNormal), vec3(0.0, 0.0, 1.0)), 0.0), 64.0);
    float mercurySpecB = pow(max(dot(reflect(-mercuryLightB, mercuryNormal), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    float mercuryFresnel = pow(1.0 - clamp(mercuryNormal.z, 0.0, 1.0), 2.4);
    float mercuryFoldA = 0.5 + 0.5 * sin(
      (mercuryDomain.x * 2.15 - mercuryDomain.y * 3.25 + mercuryFlow * 2.2) * 6.28318 +
      uTime * uMotionSpeed * 0.48
    );
    float mercuryFoldB = 0.5 + 0.5 * sin(
      (mercuryDomain.x * -4.4 + mercuryDomain.y * 2.25 + mercuryFine * 1.45) * 3.14159 -
      uTime * 0.22
    );
    float mercuryStreak = pow(smoothstep(0.52, 1.0, mercuryFoldA), 2.35);
    float mercuryDarkFold = pow(smoothstep(0.5, 1.0, 1.0 - mercuryFoldB), 1.6);
    float mercuryRidge = smoothstep(0.018, 0.0, abs(fract((mercuryUv.y * (34.0 + uRepelRadius * 26.0) + mercuryFlow * 5.0)) - 0.5)) *
      mercuryBody *
      uRepelRadius;
    float mercuryContour = smoothstep(0.026, 0.0, abs(fract((mercuryHeight * (8.0 + uRepelRadius * 14.0) + mercuryUv.x * 5.5)) - 0.5)) *
      mercuryBody *
      (0.24 + uRepelRadius * 0.24);
    float mercuryLogoShadow = mercuryBody * (1.0 - mercuryEdge) * (0.08 + surfaceDepth * 0.18);
    float mercuryTone = clamp(
      0.2 +
        mercuryDiffuse * 0.36 +
        mercuryFoldA * 0.34 +
        mercuryFlow * 0.18 +
        mercuryStreak * 0.54 -
        mercuryDarkFold * (0.18 + uScatter * 0.045) -
        mercuryLogoShadow * 0.64,
      0.0,
      1.35
    );
    vec3 mercuryColor = mix(uColorAccent * 0.82, uColorPrimary * 0.98, smoothstep(0.02, 0.9, mercuryTone));
    mercuryColor = mix(mercuryColor, uColorHighlight, clamp(mercuryStreak * 0.48 + mercurySpecA * 0.9, 0.0, 0.86));
    mercuryColor += uColorHighlight * (mercurySpecB * 0.42 + mercuryEdge * mercuryBody * (0.3 + uAttractRadius * 0.08));
    mercuryColor += vec3(1.0) * (mercuryRidge * 0.32 + mercuryContour * 0.24);
    mercuryColor -= uColorAccent * 0.11 * mercuryDarkFold * (0.32 + uScatter * 0.06);
    mercuryColor += uColorPrimary * mercuryVortex * uMouseActive * uMouseForce * 0.045;
    mercuryColor *= 0.72 + smoothstep(0.75, 0.16, length(center)) * 0.42;
    mercuryColor = max(vec3(0.0), mercuryColor - vec3((hash21(uv * ${SURFACE_TEXTURE_SIZE.toFixed(1)} + vec2(floor(uTime * 18.0))) - 0.5) * uFlicker * 0.08));

    vec3 fluidGlassNormal = normalize(vec3(
      -(fluidGlassGradient * (4.8 + surfaceDepth * 2.4) + fluidGlassWarp * (4.2 + uTurbulence)) * (0.42 + surfaceDepth * 0.78),
      0.82
    ));
    vec3 fluidGlassLight = normalize(vec3(-0.34, 0.56, 0.76));
    vec3 fluidGlassLightB = normalize(vec3(0.62, -0.24, 0.66));
    float fluidGlassSpec = pow(max(dot(reflect(-fluidGlassLight, fluidGlassNormal), vec3(0.0, 0.0, 1.0)), 0.0), 58.0);
    float fluidGlassSpecB = pow(max(dot(reflect(-fluidGlassLightB, fluidGlassNormal), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    float fluidGlassFresnel = pow(1.0 - clamp(fluidGlassNormal.z, 0.0, 1.0), 2.1);
    float fluidGlassShadow = smoothstep(0.34, 0.03, fluidGlassCell) * fluidGlassBody * 0.12;
    float fluidGlassPrism = fluidGlassEdge * fluidGlassBody * (0.18 + uScatter * 0.1);
    vec3 fluidGlassTint = mix(
      mix(uColorAccent * 0.1, uColorPrimary * 0.08, 0.4),
      uColorPrimary,
      fluidGlassBody * (0.42 + fluidGlassReaction * 0.2)
    );
    vec3 fluidGlassColor = fluidGlassTint * (0.58 + fluidGlassCell * 0.22 + fluidGlassFine * 0.16);
    fluidGlassColor += uColorAccent * fluidGlassCaustic * (0.68 + uRepelRadius * 0.26);
    fluidGlassColor += uColorHighlight * (fluidGlassSpec * 0.72 + fluidGlassSpecB * 0.24);
    fluidGlassColor += spectrum(fluidGlassCell + uTime * 0.035) * fluidGlassPrism * 0.22;
    fluidGlassColor += uColorHighlight * fluidGlassEdge * (0.2 + surfaceDepth * 0.16);
    fluidGlassColor += uColorAccent * fluidGlassLens * uMouseActive * uMouseForce * 0.035;
    fluidGlassColor -= uColorPrimary * 0.02 * fluidGlassShadow;
    fluidGlassColor += uColorPrimary * fluidGlassFresnel * fluidGlassBody * 0.16;
    fluidGlassColor *= 0.72 + smoothstep(0.78, 0.14, length(center)) * 0.34;
    fluidGlassColor = max(
      vec3(0.0),
      fluidGlassColor - vec3((hash21(uv * ${SURFACE_TEXTURE_SIZE.toFixed(1)} + vec2(floor(uTime * 16.0))) - 0.5) * uFlicker * 0.055)
    );

    vec3 shadowFace = mix(
      uColorPrimary * (0.82 + shadowPaper * 0.1),
      uColorHighlight,
      shadowRim * (0.28 + shadowEase * 0.34)
    );
    shadowFace *= 0.86 + shadowEase * surfaceDepth * 0.2;
    vec3 shadowDropColor = mix(uColorAccent * 0.74, uColorHighlight * 0.14, shadowEase) *
      shadowDropAlpha *
      (0.62 + uRepelRadius * 0.12);
    vec3 shadowColor = shadowDropColor + shadowFace * shadowBody;
    shadowColor += uColorHighlight * shadowRim * (0.22 + surfaceDepth * 0.18);
    shadowColor = max(vec3(0.0), shadowColor - vec3((shadowPaper - 0.5) * uTurbulence * 0.018));

    vec3 color =
      rippleColor * rippleStyle +
      lineColor * lineStyle +
      chromeBase * chromeStyle +
      mercuryColor * mercuryStyle +
      radianceColor * radianceStyle +
      ditherColor * ditherStyle +
      bulgeColor * bulgeStyle +
      gommageColor * gommageStyle +
      accessColor * accessStyle +
      glitchColor * glitchStyle +
      fluidColor * fluidStyle +
      fluidGlassColor * fluidGlassStyle +
      shadowColor * shadowStyle +
      vfxColor * vfxStyle;
    float surfaceOpacity = mask * body * breathe * (0.74 + birthGlow * 0.2);
    float chromeOpacity = max(mask * body, sideBody * 0.96) * breathe * (0.88 + birthGlow * 0.18);
    float radianceOpacity = clamp(mask * body * 0.96 + radianceGlow * 0.86, 0.0, 1.0) * breathe;
    float ditherOpacity = clamp(ditherTone * (0.8 + ditherBrightness * 0.35) + ditherGlowBase * 0.14, 0.0, 1.0) * breathe;
    float bulgeOpacity = clamp(
      max(max(bulgeBody, bulgeSource), bulgeFallback) * (1.04 + vBulge * 0.18) +
        bulgeRing * 0.22 +
        bulgeInfluence * 0.035,
      0.0,
      1.0
    ) * breathe;
    float gommageOpacity = clamp(
      mask * body * (gommageKeep * 0.94 + gommageResidue * 0.56) +
        gommageEdge * (0.7 + uBreathe * 0.9) +
        gommageDust * (0.42 + uScatter * 0.16),
      0.0,
      1.0
    ) * breathe;
    float vfxOpacity = clamp(
      vfxSource * 1.18 + vfxOutside * (vfxLamp * 0.13 + vfxRay * (0.86 + uMouseForce * 0.22)) + vfxGlowBase * 0.09,
      0.0,
      1.0
    ) * breathe;
    float accessOpacity = clamp(
      accessInk * (0.94 + accessEdge * 0.22) +
        birthGlow * 0.08 +
        accessSlice * accessInk * 0.05,
      0.0,
      1.0
    ) * breathe;
    float glitchOpacity = clamp(
      glitchInk * glitchReveal * (0.82 + glitchGate * 0.24) +
        glitchGlowBase * 0.22 +
        glitchBlock * glitchInk * 0.18,
      0.0,
      1.0
    ) * breathe;
    float fluidOpacity = clamp(
      fluidBody * (0.28 + fluidReveal * 0.82) +
        fluidWire * mask * (0.22 + uScatter * 0.08) +
        fluidGlowBase * 0.18,
      0.0,
      1.0
    ) * breathe;
    float fluidGlassOpacity = clamp(
      fluidGlassBody * (0.28 + fluidGlassReaction * 0.28) +
        fluidGlassGlowBase * 0.22 +
        fluidGlassCaustic * 0.14 +
        fluidGlassFresnel * fluidGlassBody * 0.11,
      0.0,
      1.0
    ) * breathe;
    float shadowOpacity = clamp(
      shadowBody * (0.88 + shadowEase * 0.12) +
        shadowDropAlpha * (0.56 + uRepelRadius * 0.1),
      0.0,
      1.0
    ) * breathe;
    float mercuryOpacity = mercuryStyle * breathe;
    float opacity = mix(surfaceOpacity, chromeOpacity, chromeStyle);
    opacity = mix(opacity, mercuryOpacity, mercuryStyle);
    opacity = mix(opacity, radianceOpacity, radianceStyle);
    opacity = mix(opacity, ditherOpacity, ditherStyle);
    opacity = mix(opacity, bulgeOpacity, bulgeStyle);
    opacity = mix(opacity, gommageOpacity, gommageStyle);
    opacity = mix(opacity, accessOpacity, accessStyle);
    opacity = mix(opacity, glitchOpacity, glitchStyle);
    opacity = mix(opacity, fluidOpacity, fluidStyle);
    opacity = mix(opacity, fluidGlassOpacity, fluidGlassStyle);
    opacity = mix(opacity, shadowOpacity, shadowStyle);
    opacity = mix(opacity, vfxOpacity, vfxStyle);

    float flickerNoise = hash21(floor(uv * 280.0) + vec2(floor(uTime * 18.0)));
    float finalFlicker = uFlicker * (1.0 - max(max(chromeStyle, mercuryStyle), fluidGlassStyle));
    float flickerGate = mix(1.0, mix(0.7, 1.08, step(finalFlicker, flickerNoise)), finalFlicker);

    gl_FragColor = vec4(color * flickerGate, clamp(opacity * reveal * flickerGate, 0.0, 1.0));
  }
`;

const trailVertexShader = `
  precision highp float;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  attribute vec3 position;
  attribute vec2 uv;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const trailPersistenceFragmentShader = `
  precision highp float;

  uniform sampler2D uPrevious;
  uniform float uTime;
  uniform float uNoiseFactor;
  uniform float uNoiseScale;
  uniform float uTrailLength;
  uniform float uRgbPersist;
  uniform float uAlphaPersist;
  uniform float uMouseForce;
  uniform float uMotionSpeed;
  uniform vec2 uMouse;
  uniform vec2 uVelocity;
  uniform vec3 uColorAccent;

  varying vec2 vUv;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = rotate * p * 2.03 + vec2(17.1, 9.7);
      amplitude *= 0.5;
    }

    return value;
  }

  void main() {
    vec2 centered = vUv - vec2(0.5);
    float time = uTime * (0.08 + uMotionSpeed * 0.1);
    vec2 flowDomain = vUv * (0.7 + uNoiseFactor * 3.2) + vec2(time, -time * 0.72);
    float noiseA = fbm(flowDomain);
    float noiseB = fbm(flowDomain + vec2(13.7, 41.2));
    vec2 flow = vec2(noiseA - 0.5, noiseB - 0.5);
    vec2 swirl = vec2(-centered.y, centered.x) * (0.002 + uTrailLength * 0.0012);
    vec2 drag = uVelocity * (0.012 + uMouseForce * 0.036);
    vec2 sampleUv = vUv + flow * uNoiseScale + swirl + drag;

    float chroma = 0.0018 + uTrailLength * 0.0018 + length(uVelocity) * uMouseForce * 0.018;
    vec2 chromaDir = normalize(flow + drag + vec2(0.0001));
    float red = texture2D(uPrevious, sampleUv + chromaDir * chroma).r;
    float green = texture2D(uPrevious, sampleUv).g;
    float blue = texture2D(uPrevious, sampleUv - chromaDir * chroma).b;
    float alpha = texture2D(uPrevious, sampleUv).a;
    vec3 persisted = vec3(red, green, blue) * uRgbPersist;
    persisted += uColorAccent * alpha * (0.015 + uTrailLength * 0.012);

    gl_FragColor = vec4(persisted, alpha * uAlphaPersist);
  }
`;

const trailSourceFragmentShader = `
  precision highp float;

  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uReveal;
  uniform float uBirthPulse;
  uniform float uSourceWeight;
  uniform float uBreathe;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorHighlight;

  varying vec2 vUv;

  float sampleMask(vec2 uv) {
    vec4 mask = texture2D(uMask, uv);
    return max(mask.a, mask.r);
  }

  void main() {
    float mask = sampleMask(vUv);
    float source = smoothstep(0.02, 0.22, mask);
    float revealLine = vUv.x * 0.72 + (1.0 - vUv.y) * 0.18;
    float reveal = smoothstep(revealLine - 0.18, revealLine + 0.12, uReveal);

    if (source * reveal < 0.006) {
      discard;
    }

    vec2 texel = vec2(${(1 / SURFACE_TEXTURE_SIZE).toFixed(8)});
    float left = sampleMask(vUv - vec2(texel.x, 0.0));
    float right = sampleMask(vUv + vec2(texel.x, 0.0));
    float down = sampleMask(vUv - vec2(0.0, texel.y));
    float up = sampleMask(vUv + vec2(0.0, texel.y));
    float edge = smoothstep(0.04, 0.45, length(vec2(right - left, up - down)));
    float pulse = 1.0 + sin(uTime * 2.0 + mask * 4.0) * uBreathe;
    vec3 color = mix(uColorPrimary, uColorHighlight, edge * 0.34 + uBirthPulse * 0.18);
    float alpha = source * reveal * pulse * (0.7 + uSourceWeight * 0.09);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

const trailDisplayFragmentShader = `
  precision highp float;

  uniform sampler2D uTexture;
  uniform float uExposure;

  varying vec2 vUv;

  void main() {
    vec4 trail = texture2D(uTexture, vUv);

    if (trail.a < 0.004) {
      discard;
    }

    vec3 color = trail.rgb * uExposure;
    color += vec3(1.0) * pow(trail.a, 2.0) * 0.035;

    gl_FragColor = vec4(color, clamp(trail.a * 1.08, 0.0, 1.0));
  }
`;

export function ParticleLogoScene({
  svgText,
  svgTextB,
  morphBlend = 0,
  captureClean = false,
  settings,
  replayNonce,
  paused,
  webglSupported,
  webgpuSupported
}: ParticleLogoSceneProps) {
  const surfaceStyle = isSurfaceStyle(settings.logoStyle);
  const metalStyle = settings.logoStyle === "metal";
  const asciiStyle = settings.logoStyle === "ascii";
  const asciiRasterStyle = settings.logoStyle === "ascii2";
  const fancyStyle = settings.logoStyle === "fancy";
  const walkersStyle = settings.logoStyle === "walkers";
  const sdfStyle = settings.logoStyle === "sdf";
  const particleMorph = !surfaceStyle && !asciiStyle && !asciiRasterStyle && !fancyStyle && !walkersStyle && !sdfStyle;
  const svgNow = morphBlend < 0.5 ? svgText : svgTextB || svgText;
  const asciiParticleCount = Math.min(
    5600,
    Math.max(1800, Math.round(settings.particleCount * 0.28))
  );
  const buffers = useMemo(
    () =>
      particleMorph ? sampleSvgToParticles(svgText, settings.particleCount, 19) : null,
    [particleMorph, settings.particleCount, svgText]
  );
  const buffersB = useMemo(() => {
    if (!particleMorph || !svgTextB || svgTextB === svgText) {
      return null;
    }
    try {
      return sampleSvgToParticles(svgTextB, settings.particleCount, 19);
    } catch {
      return null;
    }
  }, [particleMorph, settings.particleCount, svgText, svgTextB]);
  const asciiBuffers = useMemo(
    () => (asciiStyle ? sampleSvgToParticles(svgNow, asciiParticleCount, 23) : null),
    [asciiParticleCount, asciiStyle, svgNow]
  );

  if (!webglSupported) {
    return (
      <div className="scene-fallback">
        <strong>WebGL unavailable</strong>
        <span>This browser cannot create the particle renderer.</span>
      </div>
    );
  }

  return (
    <div
      data-capture-root
      className={`scene-wrap scene-style-${settings.logoStyle} ${
        settings.gridVisible ? "with-grid" : ""
      } ${sdfStyle && settings.handControl ? "with-camera" : ""}`}
    >
      <Canvas
        shadows
        style={sdfStyle && settings.handControl ? { zIndex: 1 } : undefined}
        camera={{ position: [0, 0, 6.2], fov: 44, near: 0.1, far: 40 }}
        dpr={[1, 2]}
        gl={{
          antialias: metalStyle,
          alpha: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true
        }}
      >
        <ambientLight intensity={metalStyle ? 0.42 : 0.2} />
        {metalStyle && <ChromeStudioLighting />}
        <ResponsiveLogoScale>
          {metalStyle ? (
            <ChromeExtrudedLogo
              svgText={svgNow}
              settings={settings}
              replayNonce={replayNonce}
              paused={paused}
            />
          ) : asciiStyle && asciiBuffers ? (
            <AsciiGlyphParticles
              buffers={asciiBuffers}
              settings={settings}
              replayNonce={replayNonce}
              paused={paused}
            />
          ) : settings.logoStyle === "trail" ? (
            <SvgTrailFeedback
              svgText={svgNow}
              settings={settings}
              replayNonce={replayNonce}
              paused={paused}
            />
          ) : sdfStyle ? (
            <SdfBubbleLogo
              svgText={svgNow}
              settings={settings}
              replayNonce={replayNonce}
              paused={paused}
            />
          ) : surfaceStyle ? (
            <SvgSurfaceShader
              svgText={svgNow}
              settings={settings}
              replayNonce={replayNonce}
              paused={paused}
            />
          ) : buffers ? (
            <ParticleCloud
              buffers={buffers}
              buffersB={buffersB}
              morphBlend={morphBlend}
              settings={settings}
              replayNonce={replayNonce}
              paused={paused}
            />
          ) : null}
        </ResponsiveLogoScale>
        {!sdfStyle && (
        <EffectComposer multisampling={0}>
          <Noise
            blendFunction={BlendFunction.SCREEN}
            premultiply
            opacity={0.055}
          />
          <Vignette offset={0.18} darkness={0.72} eskil={false} />
        </EffectComposer>
        )}
      </Canvas>
      {asciiRasterStyle && (
        <AsciiRasterOverlay
          svgText={svgNow}
          settings={settings}
          replayNonce={replayNonce}
          paused={paused}
        />
      )}
      {fancyStyle && (
        <FancyLetterOverlay
          svgText={svgNow}
          settings={settings}
          replayNonce={replayNonce}
          paused={paused}
        />
      )}
      {walkersStyle && (
        <WebcamWalkersOverlay
          svgText={svgText}
          svgTextB={svgTextB}
          morphBlend={morphBlend}
          captureClean={captureClean}
          settings={settings}
          replayNonce={replayNonce}
          paused={paused}
        />
      )}
      {!walkersStyle && settings.handControl && (
        <HandPointerControl
          nativeGestures={sdfStyle}
          cameraPresentation={sdfStyle ? "background" : "preview"}
          hint={sdfStyle ? "Open palm · push   /   Fist · gather   /   Pinch · lift   /   Point · swirl" : undefined}
        />
      )}
      <div className="scene-scanlines" aria-hidden="true" />
      {settings.renderMode === "webgpu-tsl" && (
        <div className="render-mode-note">
          {webgpuSupported
            ? "TSL preview selected. WebGL shader parity is active in v1."
            : "WebGPU is not exposed in this browser. WebGL is active."}
        </div>
      )}
    </div>
  );
}

function getResponsiveLogoScale(width: number, height: number) {
  return Math.min(
    1,
    Math.max(0.56, Math.min(width / 5.6, height / 5.0))
  );
}

function ResponsiveLogoScale({ children }: { children: ReactNode }) {
  const viewport = useThree((state) => state.viewport);
  const scale = getResponsiveLogoScale(viewport.width, viewport.height);

  return <group scale={scale}>{children}</group>;
}

function getStyleIndex(style: LogoStyle) {
  if (style === "ripples") {
    return 1;
  }

  if (style === "lines") {
    return 2;
  }

  if (style === "metal" || style === "chrome") {
    return 4;
  }

  if (style === "mercury") {
    return 21;
  }

  if (style === "radiance") {
    return 5;
  }

  if (style === "dither") {
    return 7;
  }

  if (style === "vfx") {
    return 8;
  }

  if (style === "bulge") {
    return 9;
  }

  if (style === "gommage") {
    return 10;
  }

  if (style === "elastic") {
    return 11;
  }

  if (style === "hyperspace") {
    return 12;
  }

  if (style === "access") {
    return 13;
  }

  if (style === "glitch") {
    return 20;
  }

  if (style === "fluid") {
    return 18;
  }

  if (style === "fluidglass") {
    return 22;
  }

  if (style === "shadow") {
    return 23;
  }

  if (style === "clouds") {
    return 14;
  }

  if (style === "bubbles") {
    return 15;
  }

  if (style === "blossom") {
    return 16;
  }

  if (style === "gaze") {
    return 17;
  }

  if (style === "ascii") {
    return 6;
  }

  return 0;
}

function isSurfaceStyle(style: LogoStyle) {
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

function ChromeStudioLighting() {
  return (
    <>
      <directionalLight position={[4.5, 4.8, 5.5]} intensity={2.4} />
      <directionalLight position={[-4.2, -1.4, 3.8]} intensity={0.75} />
      <pointLight position={[0.2, 1.6, 3.2]} intensity={1.6} color="#ffffff" />
      <Environment resolution={256}>
        <Lightformer
          form="rect"
          intensity={5.2}
          position={[-3.2, 2.8, 4]}
          scale={[5.5, 1.1, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={3.2}
          position={[3.5, -1.2, 3.2]}
          scale={[1.2, 5.5, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="ring"
          intensity={2.6}
          position={[0, 3.5, -4.2]}
          scale={4.2}
          target={[0, 0, 0]}
        />
      </Environment>
    </>
  );
}

function ChromeExtrudedLogo({
  svgText,
  settings,
  replayNonce,
  paused
}: {
  svgText: string;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const runningTime = useRef(0);
  const revealStartTime = useRef(-1000);
  const model = useMemo(
    () => createChromeGeometryModel(svgText, settings.scatterRadius, settings.pointSize),
    [settings.pointSize, settings.scatterRadius, svgText]
  );
  const material = useMemo(() => {
    const nextMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(settings.particleColor),
      metalness: 1,
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.11,
      envMapIntensity: 2.8,
      emissive: new THREE.Color(settings.particleAccentColor),
      emissiveIntensity: 0.02,
      specularColor: new THREE.Color(settings.particleHighlightColor),
      specularIntensity: 0.8,
      side: THREE.DoubleSide
    });

    nextMaterial.toneMapped = true;
    return nextMaterial;
  }, []);

  useEffect(() => {
    revealStartTime.current = runningTime.current;
  }, [replayNonce]);

  useEffect(() => {
    return () => {
      model.geometries.forEach((geometry) => geometry.dispose());
    };
  }, [model]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((_, delta) => {
    const group = groupRef.current;

    if (!group) {
      return;
    }

    if (!paused) {
      runningTime.current += delta;
    }

    const time = runningTime.current;
    const revealElapsed = time - revealStartTime.current;
    const rawReveal = Math.min(1, Math.max(0, revealElapsed * settings.animationSpeed * 0.92));
    const reveal = easeOutCubic(rawReveal);
    const drift = Math.sin(time * (0.24 + settings.animationSpeed * 0.14)) * 0.035;
    const floatAmount = settings.breathe * 0.28;

    group.rotation.x = -0.18 + Math.sin(time * 0.24) * 0.025;
    group.rotation.y = -0.34 + drift;
    group.rotation.z = 0.025 + Math.sin(time * 0.19) * 0.012;
    group.position.z = -0.32 * (1 - reveal) + Math.sin(time * 0.42) * floatAmount;
    group.scale.setScalar(0.92 + reveal * 0.08);

    material.color.set(settings.particleColor);
    material.emissive.set(settings.particleAccentColor);
    material.emissiveIntensity = settings.flicker * 0.055;
    material.specularColor.set(settings.particleHighlightColor);
    material.specularIntensity = Math.max(0.25, Math.min(1, 0.62 + settings.mouseForce * 0.24));
    material.roughness = Math.max(
      0.045,
      Math.min(0.48, 0.075 + settings.turbulence * 0.15 + Math.sin(time * 0.55) * 0.012)
    );
    material.clearcoat = Math.max(0, Math.min(1, settings.attractRadius));
    material.clearcoatRoughness = Math.max(0.025, Math.min(0.22, settings.repelRadius * 0.16));
    material.envMapIntensity = 1.45 + settings.mouseForce * 3.15;
  });

  if (model.geometries.length === 0) {
    return null;
  }

  return (
    <group ref={groupRef}>
      {model.geometries.map((geometry, index) => (
        <mesh
          key={`${geometry.uuid}-${index}`}
          geometry={geometry}
          material={material}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

function createChromeGeometryModel(
  svgText: string,
  depthControl: number,
  bevelControl: number
): ChromeGeometryModel {
  try {
    const loader = new SVGLoader();
    const svg = loader.parse(ensureSvgXmlns(svgText));
    const fillShapes: THREE.Shape[] = [];
    const strokeGeometries: THREE.BufferGeometry[] = [];
    const bounds = new THREE.Box2();

    svg.paths.forEach((path) => {
      const style = getSvgPathStyle(path);

      if (hasVisibleFill(style)) {
        SVGLoader.createShapes(path).forEach((shape) => {
          fillShapes.push(shape);
          expandBoundsFromShape(bounds, shape);
        });
      }

      const strokeStyle = getVisibleStrokeStyle(style);

      if (strokeStyle) {
        path.subPaths.forEach((subPath) => {
          const points = subPath.getPoints(56);

          if (points.length < 2) {
            return;
          }

          const strokeGeometry = SVGLoader.pointsToStroke(points, strokeStyle, 10, 0.001);
          strokeGeometry.computeBoundingBox();
          expandBoundsFromGeometry(bounds, strokeGeometry);
          strokeGeometries.push(strokeGeometry);
        });
      }
    });

    if (bounds.isEmpty()) {
      strokeGeometries.forEach((geometry) => geometry.dispose());
      return { geometries: [] };
    }

    const size = new THREE.Vector2();
    const center = new THREE.Vector2();
    bounds.getSize(size);
    bounds.getCenter(center);

    const maxSize = Math.max(size.x, size.y, 1);
    const scale = LOGO_CONTENT_WORLD_SIZE / maxSize;
    const depthAmount = Math.max(0.2, Math.min(1.8, depthControl));
    const bevelAmount = Math.max(1.2, Math.min(8, bevelControl));
    const depth = maxSize * (0.1 + depthAmount * 0.09);
    const bevelSize = Math.max(maxSize * (0.005 + bevelAmount * 0.0034), 1.4);
    const bevelThickness = Math.max(depth * (0.08 + bevelAmount * 0.018), 1.4);
    const geometries: THREE.BufferGeometry[] = [];

    fillShapes.forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        steps: 2,
        bevelEnabled: true,
        bevelSegments: 8,
        bevelSize,
        bevelThickness,
        curveSegments: 24
      });

      geometry.translate(0, 0, -depth * 0.5);
      normalizeChromeGeometry(geometry, center, scale);
      geometries.push(geometry);
    });

    strokeGeometries.forEach((strokeGeometry) => {
      const geometry = extrudeFlatStrokeGeometry(strokeGeometry, depth * 0.86);
      strokeGeometry.dispose();
      normalizeChromeGeometry(geometry, center, scale);
      geometries.push(geometry);
    });

    return { geometries };
  } catch (error) {
    console.warn("Chrome SVG extrusion failed.", error);
    return { geometries: [] };
  }
}

function getSvgPathStyle(path: SVGLoader["parse"] extends (text: string) => infer Result
  ? Result extends { paths: Array<infer Path> }
    ? Path
    : never
  : never) {
  return (path.userData?.style ?? {}) as Record<string, unknown>;
}

function hasVisibleFill(style: Record<string, unknown>) {
  const fill = String(style.fill ?? "").trim().toLowerCase();
  const opacity = Number(style.fillOpacity ?? style.opacity ?? 1);

  return fill !== "none" && fill !== "transparent" && opacity > 0;
}

function getVisibleStrokeStyle(style: Record<string, unknown>): StrokeStyle | null {
  const strokeWidth = Number(style.strokeWidth ?? 0);
  const stroke = String(style.stroke ?? style.strokeColor ?? "").trim();
  const strokeOpacity = Number(style.strokeOpacity ?? style.opacity ?? 1);

  if (
    !Number.isFinite(strokeWidth) ||
    strokeWidth <= 0 ||
    stroke.toLowerCase() === "none" ||
    strokeOpacity <= 0
  ) {
    return null;
  }

  return SVGLoader.getStrokeStyle(
    strokeWidth,
    stroke || "#ffffff",
    String(style.strokeLineJoin ?? "round"),
    String(style.strokeLineCap ?? "round"),
    Number(style.strokeMiterLimit ?? 4)
  );
}

function expandBoundsFromShape(bounds: THREE.Box2, shape: THREE.Shape) {
  shape.getPoints(48).forEach((point) => bounds.expandByPoint(point));
  shape.getPointsHoles(48).forEach((hole) => {
    hole.forEach((point) => bounds.expandByPoint(point));
  });
}

function expandBoundsFromGeometry(bounds: THREE.Box2, geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");

  for (let index = 0; index < position.count; index += 1) {
    bounds.expandByPoint(new THREE.Vector2(position.getX(index), position.getY(index)));
  }
}

function normalizeChromeGeometry(
  geometry: THREE.BufferGeometry,
  center: THREE.Vector2,
  scale: number
) {
  geometry.translate(-center.x, -center.y, 0);
  geometry.scale(scale, -scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function extrudeFlatStrokeGeometry(flatGeometry: THREE.BufferGeometry, depth: number) {
  const { positions, indices } = getIndexedFlatGeometryData(flatGeometry);
  const vertexCount = positions.length / 3;
  const halfDepth = depth * 0.5;
  const extrudedPositions = new Float32Array(vertexCount * 6);
  const extrudedIndices: number[] = [];

  for (let index = 0; index < vertexCount; index += 1) {
    const sourceIndex = index * 3;
    const frontIndex = index * 3;
    const backIndex = (index + vertexCount) * 3;

    extrudedPositions[frontIndex] = positions[sourceIndex];
    extrudedPositions[frontIndex + 1] = positions[sourceIndex + 1];
    extrudedPositions[frontIndex + 2] = halfDepth;
    extrudedPositions[backIndex] = positions[sourceIndex];
    extrudedPositions[backIndex + 1] = positions[sourceIndex + 1];
    extrudedPositions[backIndex + 2] = -halfDepth;
  }

  const edges = new Map<string, { a: number; b: number; count: number }>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const edge = edges.get(key);

    if (edge) {
      edge.count += 1;
      return;
    }

    edges.set(key, { a, b, count: 1 });
  };

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];

    extrudedIndices.push(a, b, c);
    extrudedIndices.push(c + vertexCount, b + vertexCount, a + vertexCount);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  edges.forEach((edge) => {
    if (edge.count !== 1) {
      return;
    }

    const a = edge.a;
    const b = edge.b;
    const backA = a + vertexCount;
    const backB = b + vertexCount;
    extrudedIndices.push(a, b, backB);
    extrudedIndices.push(a, backB, backA);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(extrudedPositions, 3));
  geometry.setIndex(extrudedIndices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function getIndexedFlatGeometryData(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const sourceIndices = index
    ? Array.from(index.array, (value) => Number(value))
    : Array.from({ length: position.count }, (_, value) => value);
  const positions: number[] = [];
  const remap = new Map<string, number>();

  const getVertexIndex = (sourceIndex: number) => {
    const x = position.getX(sourceIndex);
    const y = position.getY(sourceIndex);
    const z = position.getZ(sourceIndex);
    const key = `${Math.round(x * 10000)}:${Math.round(y * 10000)}:${Math.round(z * 10000)}`;
    const existingIndex = remap.get(key);

    if (existingIndex !== undefined) {
      return existingIndex;
    }

    const nextIndex = positions.length / 3;
    positions.push(x, y, z);
    remap.set(key, nextIndex);
    return nextIndex;
  };

  return {
    positions,
    indices: sourceIndices.map((sourceIndex) => getVertexIndex(sourceIndex))
  };
}

function SvgTrailFeedback({
  svgText,
  settings,
  replayNonce,
  paused
}: {
  svgText: string;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const texture = useSvgMaskTexture(svgText, settings.maskRoughness);
  const gl = useThree((state) => state.gl);
  const runningTime = useRef(0);
  const revealStartTime = useRef(0);
  const resetOnNextFrame = useRef(true);
  const readTarget = useRef<THREE.WebGLRenderTarget | null>(null);
  const writeTarget = useRef<THREE.WebGLRenderTarget | null>(null);
  const pointerTarget = useRef(new THREE.Vector2(0.5, 0.5));
  const pointerLag = useRef(new THREE.Vector2(0.5, 0.5));
  const pointerVelocity = useRef(new THREE.Vector2(0, 0));
  const lastPointerAt = useRef(-Infinity);
  const previousClearColor = useRef(new THREE.Color());

  const renderTargets = useMemo(() => {
    const options = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    };
    const firstTarget = new THREE.WebGLRenderTarget(
      SURFACE_TEXTURE_SIZE,
      SURFACE_TEXTURE_SIZE,
      options
    );
    const secondTarget = firstTarget.clone();

    firstTarget.texture.name = "trail-feedback-a";
    secondTarget.texture.name = "trail-feedback-b";
    return [firstTarget, secondTarget] as const;
  }, []);

  if (!readTarget.current) {
    readTarget.current = renderTargets[0];
  }

  if (!writeTarget.current) {
    writeTarget.current = renderTargets[1];
  }

  const trailResources = useMemo(() => {
    if (!texture) {
      return null;
    }

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    camera.updateProjectionMatrix();

    const geometry = new THREE.PlaneGeometry(2, 2);
    const feedbackMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        uPrevious: { value: renderTargets[0].texture },
        uTime: { value: 0 },
        uNoiseFactor: { value: 1 },
        uNoiseScale: { value: 0.0032 },
        uTrailLength: { value: settings.scatterRadius },
        uRgbPersist: { value: settings.attractRadius },
        uAlphaPersist: { value: 0.97 },
        uMouseForce: { value: settings.mouseForce },
        uMotionSpeed: { value: settings.animationSpeed },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uVelocity: { value: new THREE.Vector2(0, 0) },
        uColorAccent: { value: new THREE.Color(settings.particleAccentColor) }
      },
      vertexShader: trailVertexShader,
      fragmentShader: trailPersistenceFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });
    const sourceMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        uMask: { value: texture },
        uTime: { value: 0 },
        uReveal: { value: 1 },
        uBirthPulse: { value: 0 },
        uSourceWeight: { value: settings.pointSize },
        uBreathe: { value: settings.breathe },
        uColorPrimary: { value: new THREE.Color(settings.particleColor) },
        uColorHighlight: { value: new THREE.Color(settings.particleHighlightColor) }
      },
      vertexShader: trailVertexShader,
      fragmentShader: trailSourceFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });
    const displayMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        uTexture: { value: renderTargets[0].texture },
        uExposure: { value: 1.1 }
      },
      vertexShader: trailVertexShader,
      fragmentShader: trailDisplayFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });
    const feedbackScene = new THREE.Scene();
    const sourceScene = new THREE.Scene();

    feedbackMaterial.toneMapped = false;
    sourceMaterial.toneMapped = false;
    displayMaterial.toneMapped = false;
    feedbackScene.add(new THREE.Mesh(geometry, feedbackMaterial));
    sourceScene.add(new THREE.Mesh(geometry, sourceMaterial));

    return {
      camera,
      displayMaterial,
      feedbackMaterial,
      feedbackScene,
      geometry,
      sourceMaterial,
      sourceScene
    };
  }, [renderTargets, texture]);

  useEffect(() => {
    resetOnNextFrame.current = true;
    revealStartTime.current = runningTime.current;
  }, [replayNonce, texture]);

  useEffect(() => {
    const canvas = gl.domElement;

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      pointerTarget.current.set(
        Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
      );
      lastPointerAt.current = performance.now() / 1000;
    };

    const deactivatePointer = () => {
      lastPointerAt.current = -Infinity;
      pointerVelocity.current.set(0, 0);
    };

    canvas.addEventListener("pointermove", updatePointer);
    canvas.addEventListener("pointerdown", updatePointer);
    canvas.addEventListener("pointerleave", deactivatePointer);
    window.addEventListener("blur", deactivatePointer);

    return () => {
      canvas.removeEventListener("pointermove", updatePointer);
      canvas.removeEventListener("pointerdown", updatePointer);
      canvas.removeEventListener("pointerleave", deactivatePointer);
      window.removeEventListener("blur", deactivatePointer);
    };
  }, [gl]);

  useEffect(() => {
    return () => {
      renderTargets.forEach((target) => target.dispose());
    };
  }, [renderTargets]);

  useEffect(() => {
    return () => {
      trailResources?.displayMaterial.dispose();
      trailResources?.feedbackMaterial.dispose();
      trailResources?.sourceMaterial.dispose();
      trailResources?.geometry.dispose();
    };
  }, [trailResources]);

  useFrame((_, delta) => {
    if (!trailResources || !texture || paused) {
      return;
    }

    runningTime.current += delta;

    const read = readTarget.current;
    const write = writeTarget.current;

    if (!read || !write) {
      return;
    }

    if (resetOnNextFrame.current) {
      clearTrailRenderTargets(gl, renderTargets, previousClearColor.current);
      resetOnNextFrame.current = false;
    }

    const now = performance.now() / 1000;
    const pointerActive = Math.max(0, Math.min(1, 1 - (now - lastPointerAt.current) / 0.85));
    pointerLag.current.lerp(pointerTarget.current, 1 - Math.exp(-delta * 6.5));
    pointerVelocity.current
      .copy(pointerTarget.current)
      .sub(pointerLag.current)
      .multiplyScalar(pointerActive);

    const revealElapsed = runningTime.current - revealStartTime.current;
    const reveal = Math.min(1, revealElapsed * settings.animationSpeed * 0.72);
    const easedReveal = easeOutCubic(reveal);
    const birthPulse = Math.sin(reveal * Math.PI) * (1 - reveal * 0.08);
    const noiseFactor = 0.7 + settings.turbulence * 4.8;
    const noiseScale = 0.0015 + settings.repelRadius * 0.012 + settings.scatterRadius * 0.001;
    const rgbPersist = Math.min(0.996, Math.max(0.82, settings.attractRadius));
    const alphaPersist = Math.min(0.992, Math.max(0.72, 0.988 - settings.flicker * 0.16));

    trailResources.feedbackMaterial.uniforms.uPrevious.value = read.texture;
    trailResources.feedbackMaterial.uniforms.uTime.value = runningTime.current;
    trailResources.feedbackMaterial.uniforms.uNoiseFactor.value = noiseFactor;
    trailResources.feedbackMaterial.uniforms.uNoiseScale.value = noiseScale;
    trailResources.feedbackMaterial.uniforms.uTrailLength.value = settings.scatterRadius;
    trailResources.feedbackMaterial.uniforms.uRgbPersist.value = rgbPersist;
    trailResources.feedbackMaterial.uniforms.uAlphaPersist.value = alphaPersist;
    trailResources.feedbackMaterial.uniforms.uMouseForce.value = settings.mouseForce;
    trailResources.feedbackMaterial.uniforms.uMotionSpeed.value = settings.animationSpeed;
    trailResources.feedbackMaterial.uniforms.uMouse.value.copy(pointerLag.current);
    trailResources.feedbackMaterial.uniforms.uVelocity.value.copy(pointerVelocity.current);
    trailResources.feedbackMaterial.uniforms.uColorAccent.value.set(settings.particleAccentColor);

    trailResources.sourceMaterial.uniforms.uMask.value = texture;
    trailResources.sourceMaterial.uniforms.uTime.value = runningTime.current;
    trailResources.sourceMaterial.uniforms.uReveal.value = easedReveal;
    trailResources.sourceMaterial.uniforms.uBirthPulse.value = Math.max(0, birthPulse);
    trailResources.sourceMaterial.uniforms.uSourceWeight.value = settings.pointSize;
    trailResources.sourceMaterial.uniforms.uBreathe.value = settings.breathe;
    trailResources.sourceMaterial.uniforms.uColorPrimary.value.set(settings.particleColor);
    trailResources.sourceMaterial.uniforms.uColorHighlight.value.set(settings.particleHighlightColor);

    const previousAutoClear = gl.autoClear;
    const previousTarget = gl.getRenderTarget();
    const previousClearAlpha = gl.getClearAlpha();
    gl.getClearColor(previousClearColor.current);

    gl.autoClear = true;
    gl.setRenderTarget(write);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
    gl.render(trailResources.feedbackScene, trailResources.camera);
    gl.autoClear = false;
    gl.render(trailResources.sourceScene, trailResources.camera);
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(previousClearColor.current, previousClearAlpha);
    gl.autoClear = previousAutoClear;

    readTarget.current = write;
    writeTarget.current = read;
    trailResources.displayMaterial.uniforms.uTexture.value = write.texture;
    trailResources.displayMaterial.uniforms.uExposure.value = 1.02 + settings.pointSize * 0.025;
  });

  if (!trailResources) {
    return null;
  }

  return (
    <mesh
      material={trailResources.displayMaterial}
      scale={[SURFACE_PLANE_WORLD_SIZE, SURFACE_PLANE_WORLD_SIZE, 1]}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

function clearTrailRenderTargets(
  gl: THREE.WebGLRenderer,
  targets: readonly THREE.WebGLRenderTarget[],
  clearColor: THREE.Color
) {
  const previousTarget = gl.getRenderTarget();
  const previousClearAlpha = gl.getClearAlpha();
  gl.getClearColor(clearColor);

  targets.forEach((target) => {
    gl.setRenderTarget(target);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
  });

  gl.setRenderTarget(previousTarget);
  gl.setClearColor(clearColor, previousClearAlpha);
}

function SvgSurfaceShader({
  svgText,
  settings,
  replayNonce,
  paused
}: {
  svgText: string;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const texture = useSvgMaskTexture(svgText, settings.maskRoughness);
  const gl = useThree((state) => state.gl);
  const runningTime = useRef(0);
  const revealStartTime = useRef(-1000);
  const pointerTarget = useRef(new THREE.Vector2(0.5, 0.5));
  const pointerLag = useRef(new THREE.Vector2(0.5, 0.5));
  const pointerVelocity = useRef(new THREE.Vector2(0, 0));
  const lastPointerAt = useRef(-Infinity);

  const material = useMemo(() => {
    if (!texture) {
      return null;
    }

    const shaderMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        uMask: { value: texture },
        uTime: { value: 0 },
        uStyle: { value: getStyleIndex(settings.logoStyle) },
        uTurbulence: { value: settings.turbulence },
        uFlicker: { value: settings.flicker },
        uBreathe: { value: settings.breathe },
        uReveal: { value: 1 },
        uBirthPulse: { value: 0 },
        uPointSize: { value: settings.pointSize },
        uMouseForce: { value: settings.mouseForce },
        uAttractRadius: { value: settings.attractRadius },
        uRepelRadius: { value: settings.repelRadius },
        uScatter: { value: settings.scatterRadius },
        uMotionSpeed: { value: settings.animationSpeed },
        uSurfaceDepth: { value: settings.surfaceDepth },
        uMouseActive: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uVelocity: { value: new THREE.Vector2(0, 0) },
        uColorPrimary: { value: new THREE.Color(settings.particleColor) },
        uColorAccent: { value: new THREE.Color(settings.particleAccentColor) },
        uColorHighlight: { value: new THREE.Color(settings.particleHighlightColor) }
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });

    shaderMaterial.toneMapped = false;
    return shaderMaterial;
  }, [texture]);

  useEffect(() => {
    revealStartTime.current = runningTime.current;
  }, [replayNonce]);

  useEffect(() => {
    const canvas = gl.domElement;

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      pointerTarget.current.set(
        Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
      );
      lastPointerAt.current = performance.now() / 1000;
    };

    const deactivatePointer = () => {
      lastPointerAt.current = -Infinity;
      pointerVelocity.current.set(0, 0);
    };

    canvas.addEventListener("pointermove", updatePointer);
    canvas.addEventListener("pointerdown", updatePointer);
    canvas.addEventListener("pointerleave", deactivatePointer);
    window.addEventListener("blur", deactivatePointer);

    return () => {
      canvas.removeEventListener("pointermove", updatePointer);
      canvas.removeEventListener("pointerdown", updatePointer);
      canvas.removeEventListener("pointerleave", deactivatePointer);
      window.removeEventListener("blur", deactivatePointer);
    };
  }, [gl]);

  useEffect(() => {
    return () => {
      material?.dispose();
    };
  }, [material]);

  useFrame((_, delta) => {
    if (!material || paused) {
      return;
    }

    runningTime.current += delta;
    const now = performance.now() / 1000;
    const pointerActive = Math.max(0, Math.min(1, 1 - (now - lastPointerAt.current) / 0.9));
    const follow = Math.max(0.035, Math.min(0.32, 0.28 / Math.max(0.35, settings.attractRadius)));
    pointerLag.current.lerp(pointerTarget.current, follow);
    pointerVelocity.current
      .copy(pointerTarget.current)
      .sub(pointerLag.current)
      .multiplyScalar(pointerActive);

    const revealElapsed = runningTime.current - revealStartTime.current;
    const rawReveal = Math.min(1, Math.max(0, revealElapsed * settings.animationSpeed * 0.72));
    const reveal = easeOutCubic(rawReveal);
    const birthPulse = Math.sin(rawReveal * Math.PI) * (1 - rawReveal * 0.08);

    material.uniforms.uMask.value = texture;
    material.uniforms.uTime.value = runningTime.current;
    material.uniforms.uStyle.value = getStyleIndex(settings.logoStyle);
    material.uniforms.uTurbulence.value = settings.turbulence;
    material.uniforms.uFlicker.value = settings.flicker;
    material.uniforms.uBreathe.value = settings.breathe;
    material.uniforms.uReveal.value = reveal;
    material.uniforms.uBirthPulse.value = Math.max(0, birthPulse);
    material.uniforms.uPointSize.value = settings.pointSize;
    material.uniforms.uMouseForce.value = settings.mouseForce;
    material.uniforms.uAttractRadius.value = settings.attractRadius;
    material.uniforms.uRepelRadius.value = settings.repelRadius;
    material.uniforms.uScatter.value = settings.scatterRadius;
    material.uniforms.uMotionSpeed.value = settings.animationSpeed;
    material.uniforms.uSurfaceDepth.value = settings.surfaceDepth;
    material.uniforms.uMouseActive.value = pointerActive;
    material.uniforms.uMouse.value.copy(pointerLag.current);
    material.uniforms.uVelocity.value.copy(pointerVelocity.current);
    material.uniforms.uColorPrimary.value.set(settings.particleColor);
    material.uniforms.uColorAccent.value.set(settings.particleAccentColor);
    material.uniforms.uColorHighlight.value.set(settings.particleHighlightColor);
  });

  if (!material) {
    return null;
  }

  return (
    <mesh
      material={material}
      scale={[SURFACE_PLANE_WORLD_SIZE, SURFACE_PLANE_WORLD_SIZE, 1]}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1, 128, 128]} />
    </mesh>
  );
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
}

const SDF_BUBBLE_MAX = 384;
const SDF_PLANE_HALF = SURFACE_PLANE_WORLD_SIZE / 2;
const SDF_MAX_BUBBLE_SPEED = 0.18;

function getSdfActiveBubbleCount(particleCount: number) {
  return Math.round(THREE.MathUtils.clamp(
    128 + ((particleCount - 6000) / 42000) * (SDF_BUBBLE_MAX - 128),
    128,
    SDF_BUBBLE_MAX
  ));
}

function getSdfBubbleSizeScale(pointSize: number, bubbleCount: number) {
  // Keep the low end small enough to reveal narrow strokes and interior gaps.
  return (0.22 + pointSize * 0.1) * Math.sqrt(274 / bubbleCount);
}

const sdfBubbleVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const sdfBubbleFragmentShader = `
  precision highp float;

  uniform float uFlicker;
  uniform int uBubbleCount;
  uniform vec3 uColorPrimary;
  uniform vec3 uColorAccent;
  uniform vec3 uColorHighlight;
  uniform vec4 uBubbles[${SDF_BUBBLE_MAX}];

  varying vec2 vUv;

  vec3 cloudField(vec2 p) {
    vec3 field = vec3(1000.0, 1.0, 0.0);
    for (int j = 0; j < ${SDF_BUBBLE_MAX}; j++) {
      if (j >= uBubbleCount) break;
      vec4 puff = uBubbles[j];
      if (puff.z < 0.0002 || puff.w < 0.002) continue;

      vec2 offset = p - puff.xy;
      float d = length(offset) - puff.z;
      // Keep individual round lobes and small gaps visible at every puff size.
      float blend = min(0.007, puff.z * 0.38);
      if (d > field.x + blend) continue;
      float h = clamp(0.5 + 0.5 * (d - field.x) / blend, 0.0, 1.0);
      vec2 q = offset / puff.z;
      float crown = sqrt(max(0.0, 1.0 - dot(q, q)));
      float shade = 0.86 + crown * 0.14;
      field = mix(vec3(d, shade, puff.w), field, h);
      field.x -= blend * h * (1.0 - h);
    }
    return field;
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    vec3 field = cloudField(uv);
    float edge = max(fwidth(field.x) * 0.8, 0.0009);
    float alpha = (1.0 - smoothstep(-edge, edge, field.x)) * field.z;
    if (alpha < 0.002) discard;

    float grain = fract(sin(dot(uv * 180.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    vec3 base = mix(uColorAccent, uColorPrimary, 0.75);
    vec3 color = base * field.y + uColorHighlight * 0.025;
    color -= grain * uFlicker * 0.05;
    gl_FragColor = vec4(max(color, vec3(0.0)), alpha);
  }
`;

type SdfBubbleRole = "body" | "riser";

type SdfBubble = {
  pos: THREE.Vector2;
  vel: THREE.Vector2;
  radius: number;
  baseRadius: number;
  seed: number;
  cycleRate: number;
  cyclePhase: number;
  age: number;
  lifetime: number;
  opacity: number;
  interaction: number;
  role: SdfBubbleRole;
  anchorX: number;
  anchorY: number;
  /** Drift mode: a stray dot orbiting the silhouette instead of packing it. */
  satellite?: boolean;
};

function worldToSdfSpace(x: number, y: number) {
  return new THREE.Vector2(x / SDF_PLANE_HALF, y / SDF_PLANE_HALF);
}

type SdfMaskSampler = {
  sample: (x: number, y: number) => number;
};

function sdfToMaskPixel(x: number, y: number, width: number, height: number) {
  const u = THREE.MathUtils.clamp(x * 0.5 + 0.5, 0, 1);
  const v = THREE.MathUtils.clamp(y * 0.5 + 0.5, 0, 1);
  return {
    u,
    v,
    px: Math.min(width - 1, Math.floor(u * (width - 1))),
    py: Math.min(height - 1, Math.floor((1 - v) * (height - 1)))
  };
}

function createSdfMaskSampler(canvas: HTMLCanvasElement): SdfMaskSampler | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  return {
    sample: (x, y) => {
      if (Math.abs(x) > 1 || Math.abs(y) > 1) return 0;
      const { px, py } = sdfToMaskPixel(x, y, width, height);
      return pixels[(py * width + px) * 4] / 255;
    }
  };
}

// Sample exposed upper edges once. Each disconnected part of the SVG can emit
// puffs, including low islands and the lower edges of counters.
function createAquariumEmitters(origins: THREE.Vector2[], mask: SdfMaskSampler) {
  const emitters: THREE.Vector2[] = [];
  for (let i = 0; i < origins.length; i += 3) {
    const p = origins[i];
    if (mask.sample(p.x, p.y) > 0.3 && mask.sample(p.x, p.y + 0.025) < 0.3) {
      emitters.push(p.clone());
    }
  }
  return emitters.length > 0 ? emitters : origins;
}

function createSdfBodyAnchors(
  origins: THREE.Vector2[],
  total: number,
  mask: SdfMaskSampler | null
) {
  const interior = mask ? origins.filter((point) => mask.sample(point.x, point.y) > 0.3) : origins;
  const candidates = interior.length > 0 ? interior : origins;
  if (candidates.length === 0) return [];

  // Farthest-point sampling fills the largest uncovered region each time. Thin
  // strokes and disconnected islands receive anchors instead of random gaps.
  const nearest = new Float32Array(candidates.length).fill(Infinity);
  const anchors: THREE.Vector2[] = [];
  let next = 0;
  for (let index = 0; index < Math.min(total, candidates.length); index += 1) {
    const anchor = candidates[next];
    anchors.push(anchor.clone());
    let farthest = -1;
    for (let candidate = 0; candidate < candidates.length; candidate += 1) {
      nearest[candidate] = Math.min(nearest[candidate], anchor.distanceToSquared(candidates[candidate]));
      if (nearest[candidate] > farthest) {
        farthest = nearest[candidate];
        next = candidate;
      }
    }
    if (farthest < 1e-10) break;
  }
  return anchors;
}

function sdfSeedFraction(seed: number) {
  return seed - Math.floor(seed);
}

function createSdfBubbleCycle(seed: number) {
  const fraction = sdfSeedFraction(seed * 4.173 + 0.19);
  return {
    cycleRate: 0.72 + fraction * 1.85,
    cyclePhase: seed * 17.93 + fraction * 6.28
  };
}

function applySdfAquariumRise(
  bubble: SdfBubble,
  time: number,
  speed: number,
  turbulence: number,
  spread: number,
  dt: number
) {
  const phase = bubble.cyclePhase;
  const progress = THREE.MathUtils.clamp(bubble.age / bubble.lifetime, 0, 1);
  // Nearby puffs share a current, while their own wobble prevents lockstep motion.
  const current = Math.sin(bubble.pos.y * 8 - time * 0.65 + bubble.anchorX * 5);
  const wobble = Math.sin(time * bubble.cycleRate * 1.4 + phase);
  const targetX = current * (0.007 + turbulence * 0.018) +
    wobble * 0.012 * spread + (bubble.seed - 0.5) * spread * 0.016;
  const targetY = speed * (0.65 + Math.sqrt(bubble.baseRadius / 0.016) * 0.5) *
    (0.7 + progress * 0.55);
  const response = (1 - Math.exp(-2.6 * dt)) * (1 - bubble.interaction * 0.8);
  bubble.vel.x += (targetX - bubble.vel.x) * response;
  bubble.vel.y += (targetY - bubble.vel.y) * response;
}

function applySdfBodyMotion(
  bubble: SdfBubble,
  time: number,
  settings: ParticleSettings,
  dt: number
) {
  const aquarium = settings.sdfMotionMode === "aquarium";
  const rate = (0.65 + settings.animationSpeed * 1.8) *
    (0.85 + sdfSeedFraction(bubble.seed * 7.13) * 0.3);
  const phase = time * rate + bubble.cyclePhase;
  const orbit = bubble.satellite
    ? 0.018 + settings.scatterRadius * 0.024
    : bubble.baseRadius * (aquarium
      ? 0.65 + settings.turbulence * 0.65
      : 0.3 + settings.turbulence * 0.35);
  const orbitX = orbit * (aquarium ? 0.55 : 1);
  const orbitY = orbit * (aquarium ? 1.25 : 0.7);
  const sin = Math.sin(phase);
  const cos = Math.cos(phase);
  const targetX = bubble.anchorX + sin * orbitX;
  const targetY = bubble.anchorY + cos * orbitY;
  const targetVx = cos * orbitX * rate;
  const targetVy = -sin * orbitY * rate;

  // Follow both the moving target and its velocity: damping must not swallow
  // the animation. Gestures temporarily loosen the spring so puffs can leave.
  const stiffness = 28 + settings.attractRadius * 12;
  const damping = Math.sqrt(stiffness) * 1.7;
  const hold = 1 - bubble.interaction * 0.96;
  const drag = 1 - bubble.interaction * 0.88;
  bubble.vel.x += ((targetX - bubble.pos.x) * stiffness * hold +
    (targetVx - bubble.vel.x) * damping * drag) * dt;
  bubble.vel.y += ((targetY - bubble.pos.y) * stiffness * hold +
    (targetVy - bubble.vel.y) * damping * drag) * dt;

  // Rising lobes swell while the returning side of each local circulation
  // shrinks. Neighboring phases keep renewing the silhouette without holes.
  const pulse = aquarium ? -sin : Math.sin(phase * 0.8);
  const swell = aquarium ? 0.12 + settings.breathe * 0.5 : 0.06 + settings.breathe * 0.35;
  bubble.radius = bubble.baseRadius * (1 + pulse * swell);
  bubble.opacity = 1;
}

function getAquariumRiseSpeed(animationSpeed: number) {
  return 0.035 + animationSpeed * 0.085;
}

function createSdfBaseRadius(sizeScale: number, role: SdfBubbleRole) {
  const size = Math.random();
  if (role === "body") {
    return (0.028 + Math.pow(size, 0.7) * 0.018) * sizeScale;
  }
  // Mostly visible round puffs, with a few tiny crumbs and larger drifting lobes.
  return (0.009 + Math.pow(size, 1.3) * 0.024) * sizeScale;
}

function getSdfBodyCount(total: number) {
  return Math.round(total * 0.8);
}

function updateAquariumBubbleAppearance(bubble: SdfBubble, time: number) {
  const progress = THREE.MathUtils.clamp(bubble.age / bubble.lifetime, 0, 1);
  const birth = THREE.MathUtils.smoothstep(progress, 0, 0.12);
  const dissolve = THREE.MathUtils.smoothstep(progress, 0.64, 1);
  const swell = 0.74 + THREE.MathUtils.smoothstep(progress, 0, 0.4) * 0.34;
  const pulse = 1 + Math.sin(time * bubble.cycleRate + bubble.cyclePhase) * 0.07;
  bubble.radius = bubble.baseRadius * swell * (1 - dissolve * 0.65) * pulse;
  bubble.opacity = birth * (1 - dissolve);
}

function resetAquariumBubble(
  bubble: SdfBubble,
  emitters: THREE.Vector2[],
  settings: ParticleSettings,
  warmStart = false
) {
  const origin = emitters[Math.floor(Math.random() * emitters.length)] ?? new THREE.Vector2();
  const sizeScale = getSdfBubbleSizeScale(
    settings.pointSize,
    getSdfActiveBubbleCount(settings.particleCount)
  );
  bubble.role = "riser";
  bubble.seed = Math.random();
  bubble.baseRadius = createSdfBaseRadius(sizeScale, "riser");
  bubble.radius = bubble.baseRadius;
  const cycle = createSdfBubbleCycle(bubble.seed + origin.x * 0.3);
  bubble.cycleRate = cycle.cycleRate;
  bubble.cyclePhase = cycle.cyclePhase;
  const speed = getAquariumRiseSpeed(settings.animationSpeed);
  bubble.lifetime = (0.14 + bubble.seed * 0.23) / speed;
  bubble.age = warmStart ? Math.random() * bubble.lifetime : 0;
  bubble.pos.copy(origin);
  bubble.pos.x += (Math.random() - 0.5) * 0.018 * settings.scatterRadius;
  bubble.anchorX = bubble.pos.x;
  bubble.anchorY = bubble.pos.y;
  bubble.vel.set((bubble.seed - 0.5) * 0.012, speed);
  if (warmStart) {
    bubble.pos.addScaledVector(bubble.vel, bubble.age);
    bubble.pos.x += Math.sin(bubble.cyclePhase) * bubble.age * 0.008;
  }
  bubble.interaction = 0;
  updateAquariumBubbleAppearance(bubble, 0);
}

function clampSdfBubbleSpeed(bubble: SdfBubble, maxSpeed = SDF_MAX_BUBBLE_SPEED) {
  const speedSq = bubble.vel.lengthSq();
  const maxSpeedSq = maxSpeed * maxSpeed;

  if (speedSq > maxSpeedSq) {
    bubble.vel.multiplyScalar(maxSpeed / Math.sqrt(speedSq));
  }
}

function SdfBubbleLogo({
  svgText,
  settings,
  replayNonce,
  paused
}: {
  svgText: string;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const texture = useSvgMaskTexture(svgText, settings.maskRoughness);
  const runningTime = useRef(0);
  const simulationAccumulator = useRef(0);
  const aquariumEmitters = useRef<THREE.Vector2[]>([]);
  const grabs = useRef(new Map<TrackedHand, { index: number; x: number; y: number; vx: number; vy: number }>());
  const pointerInside = useRef(false);
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const enter = () => { pointerInside.current = true; };
    const leave = () => { pointerInside.current = false; };
    canvas.addEventListener("pointermove", enter);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      canvas.removeEventListener("pointermove", enter);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [gl]);
  const bubbles = useRef<SdfBubble[]>([]);
  const maskSampler = useRef<SdfMaskSampler | null>(null);
  const spawnOrigins = useRef<THREE.Vector2[]>([]);
  const simulationKey = useRef("");

  const layout = useMemo(() => {
    const sampleCount = Math.max(
      getSdfActiveBubbleCount(settings.particleCount) * 12,
      Math.round(settings.particleCount / 2),
      8000
    );
    const buffers = sampleSvgToParticles(svgText, sampleCount, 53);
    const origins: THREE.Vector2[] = [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < buffers.count; index += 1) {
      const worldX = buffers.positions[index * 3];
      const worldY = buffers.positions[index * 3 + 1];
      const shaderPos = worldToSdfSpace(worldX, worldY);
      origins.push(shaderPos.clone());
      minX = Math.min(minX, shaderPos.x);
      maxX = Math.max(maxX, shaderPos.x);
      minY = Math.min(minY, shaderPos.y);
      maxY = Math.max(maxY, shaderPos.y);
    }

    return {
      origins,
      bounds: {
        minX: minX - 0.02,
        maxX: maxX + 0.02,
        minY: minY - 0.02,
        maxY: maxY + 0.02
      }
    };
  }, [settings.particleCount, svgText]);

  const mask = useMemo(() => {
    if (!texture?.image) {
      return null;
    }

    return createSdfMaskSampler(texture.image as HTMLCanvasElement);
  }, [texture]);

  const material = useMemo(() => {
    if (!texture) {
      return null;
    }

    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBubbleCount: { value: 0 },
        uFlicker: { value: settings.flicker },
        uColorPrimary: { value: new THREE.Color(settings.particleColor) },
        uColorAccent: { value: new THREE.Color(settings.particleAccentColor) },
        uColorHighlight: { value: new THREE.Color(settings.particleHighlightColor) },
        uBubbles: {
          value: Array.from({ length: SDF_BUBBLE_MAX }, () => new THREE.Vector4(0, 0, 0, 0))
        }
      },
      vertexShader: sdfBubbleVertexShader,
      fragmentShader: sdfBubbleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });

    shaderMaterial.toneMapped = false;
    return shaderMaterial;
  }, [texture]);

  const resetSimulation = () => {
    maskSampler.current = mask;
    spawnOrigins.current = layout.origins.map((origin) => origin.clone());

    const bubbleCount = getSdfActiveBubbleCount(settings.particleCount);
    const nextBubbles: SdfBubble[] = [];
    const activeMask = maskSampler.current;
    aquariumEmitters.current = activeMask
      ? createAquariumEmitters(spawnOrigins.current, activeMask)
      : spawnOrigins.current;
    const bodyAnchors = createSdfBodyAnchors(
      spawnOrigins.current, getSdfBodyCount(bubbleCount), activeMask
    );

    for (let index = 0; index < bubbleCount; index += 1) {
      const bubble = createSdfBubble(
        index,
        bubbleCount,
        spawnOrigins.current,
        settings,
        bodyAnchors[index]
      );
      if (settings.sdfMotionMode === "aquarium" && bubble.role === "riser") {
        resetAquariumBubble(bubble, aquariumEmitters.current, settings, true);
      }
      nextBubbles.push(bubble);
    }

    while (nextBubbles.length < SDF_BUBBLE_MAX) {
      nextBubbles.push({
        pos: new THREE.Vector2(0, 0),
        vel: new THREE.Vector2(0, 0),
        radius: 0,
        baseRadius: 0,
        seed: Math.random(),
        cycleRate: 1,
        cyclePhase: 0,
        age: 0,
        lifetime: 1,
        opacity: 0,
        interaction: 0,
        role: "riser",
        anchorX: 0,
        anchorY: 0
      });
    }

    bubbles.current = nextBubbles;
    simulationAccumulator.current = 0;
    runningTime.current = 0;
    grabs.current.clear();
  };

  useEffect(() => {
    if (!mask) {
      return;
    }

    const nextKey = `${svgText}:${replayNonce}:${settings.particleCount}:${settings.pointSize}:${settings.sdfMotionMode}`;
    if (simulationKey.current === nextKey && bubbles.current.length > 0) {
      maskSampler.current = mask;
      aquariumEmitters.current = createAquariumEmitters(spawnOrigins.current, mask);
      return;
    }

    simulationKey.current = nextKey;
    resetSimulation();
  }, [layout, mask, replayNonce, settings.particleCount, settings.pointSize, settings.sdfMotionMode, svgText]);

  useEffect(() => {
    return () => {
      material?.dispose();
    };
  }, [material]);

  useFrame((state, delta) => {
    if (!material || paused || bubbles.current.length === 0) return;

    const frameDt = Math.min(delta, 0.05);
    const bubbleCount = getSdfActiveBubbleCount(settings.particleCount);
    const aquarium = settings.sdfMotionMode === "aquarium";
    const handView = settings.handControl && handInput.active &&
      handInput.width > 1 && handInput.height > 1 ? handInput : null;
    const visibleHands = handView?.hands.filter((hand) => hand.active > 0.5) ?? [];
    const logoScale = getResponsiveLogoScale(state.viewport.width, state.viewport.height);
    const worldToLocal = 1 / (SDF_PLANE_HALF * logoScale);
    const sx = handView ? state.viewport.width / handView.width * worldToLocal : 0;
    const sy = handView ? state.viewport.height / handView.height * worldToLocal : 0;
    const toX = (x: number) => (x - (handView?.width ?? 0) * 0.5) * sx;
    const toY = (y: number) => ((handView?.height ?? 0) * 0.5 - y) * sy;
    const mouseX = state.pointer.x * state.viewport.width * 0.5 * worldToLocal;
    const mouseY = state.pointer.y * state.viewport.height * 0.5 * worldToLocal;

    // Own grabs in this scene so switching styles, replaying, or losing a hand
    // cannot retain an index into a different particle simulation.
    for (const [hand, grab] of grabs.current) {
      if (!visibleHands.includes(hand) || hand.gesture !== "pinch" || grab.index >= bubbleCount) {
        const bubble = bubbles.current[grab.index];
        if (bubble) {
          bubble.vel.set(grab.vx, grab.vy);
          clampSdfBubbleSpeed(bubble, 0.7);
          bubble.interaction = 1;
        }
        grabs.current.delete(hand);
      }
    }
    const heldIndices = new Set(Array.from(grabs.current.values(), (grab) => grab.index));
    const forces: Array<{ gesture: HandGesture; x: number; y: number; active: number }> = [];
    for (const hand of visibleHands) {
      if (hand.gesture !== "pinch") {
        forces.push({
          gesture: hand.gesture,
          x: toX(hand.gesture === "point" ? hand.tipX : hand.x),
          y: toY(hand.gesture === "point" ? hand.tipY : hand.y),
          active: hand.active
        });
        continue;
      }
      const x = toX(hand.pinchX);
      const y = toY(hand.pinchY);
      let grab = grabs.current.get(hand);
      if (!grab) {
        let best = -1;
        let bestDistance = 0.12 ** 2;
        for (let i = 0; i < bubbleCount; i += 1) {
          const bubble = bubbles.current[i];
          if (heldIndices.has(i) || bubble.opacity < 0.25) continue;
          const distance = (bubble.pos.x - x) ** 2 + (bubble.pos.y - y) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        }
        if (best >= 0) {
          grab = { index: best, x, y, vx: 0, vy: 0 };
          grabs.current.set(hand, grab);
          heldIndices.add(best);
        }
      }
      if (grab) {
        const smoothing = 1 - Math.exp(-12 * frameDt);
        grab.vx += ((x - grab.x) / Math.max(frameDt, 0.001) - grab.vx) * smoothing;
        grab.vy += ((y - grab.y) / Math.max(frameDt, 0.001) - grab.vy) * smoothing;
        grab.x = x;
        grab.y = y;
      }
    }
    const grabbedBubbles = new Map(Array.from(grabs.current.values(), (grab) => [grab.index, grab]));

    // A fixed simulation clock makes damping, collisions, and rise speed behave
    // consistently at 30/60/120 Hz. Discard long background-tab gaps.
    const stepDt = 1 / 120;
    simulationAccumulator.current += frameDt;
    while (simulationAccumulator.current >= stepDt) {
      simulationAccumulator.current -= stepDt;
      runningTime.current += stepDt;
      const time = runningTime.current;
      for (let index = 0; index < bubbleCount; index += 1) {
        const bubble = bubbles.current[index];
        const grab = grabbedBubbles.get(index);
        if (grab) {
          const follow = 1 - Math.exp(-20 * stepDt);
          bubble.pos.x += (grab.x - bubble.pos.x) * follow;
          bubble.pos.y += (grab.y - bubble.pos.y) * follow;
          bubble.vel.set(grab.vx, grab.vy);
          bubble.interaction = 1;
          bubble.opacity = 1;
          bubble.radius = bubble.baseRadius;
          continue;
        }

        bubble.interaction *= Math.exp(-1.8 * stepDt);
        let fx = 0;
        let fy = 0;
        let influence = 0;
        for (const force of forces) {
          const dx = bubble.pos.x - force.x;
          const dy = bubble.pos.y - force.y;
          const distance = Math.max(0.003, Math.hypot(dx, dy));
          const reach = force.gesture === "fist" ? 0.5 : force.gesture === "point" ? 0.32 : 0.28;
          const falloff = Math.max(0, 1 - distance / reach) * force.active;
          if (falloff === 0) continue;
          influence = Math.max(influence, Math.min(1, falloff * 3));
          const strength = falloff * (0.6 + settings.mouseForce * 1.2);
          if (force.gesture === "fist") {
            fx -= dx / distance * strength;
            fy -= dy / distance * strength;
          } else if (force.gesture === "point") {
            fx += (-dy - dx * 0.18) / distance * strength;
            fy += (dx - dy * 0.18) / distance * strength;
          } else {
            fx += dx / distance * strength;
            fy += dy / distance * strength;
          }
        }
        if (visibleHands.length === 0 && pointerInside.current && settings.mouseForce > 0) {
          const dx = bubble.pos.x - mouseX;
          const dy = bubble.pos.y - mouseY;
          const distance = Math.max(0.003, Math.hypot(dx, dy));
          const reach = settings.repelRadius * 0.35;
          const falloff = Math.max(0, 1 - distance / Math.max(0.001, reach));
          fx += dx / distance * falloff * settings.mouseForce * 0.75;
          fy += dy / distance * falloff * settings.mouseForce * 0.75;
          influence = Math.max(influence, falloff);
        }
        bubble.interaction = Math.max(bubble.interaction, influence);

        if (aquarium && bubble.role === "riser") {
          applySdfAquariumRise(bubble, time, getAquariumRiseSpeed(settings.animationSpeed),
            settings.turbulence, settings.scatterRadius, stepDt);
        } else {
          applySdfBodyMotion(bubble, time, settings, stepDt);
        }
        bubble.vel.x += fx * stepDt;
        bubble.vel.y += fy * stepDt;
        if (aquarium && bubble.role === "riser") {
          bubble.vel.multiplyScalar(Math.exp(-0.15 * stepDt));
        }
        const maxSpeed = bubble.interaction > 0.05 ? 0.7 :
          aquarium ? (bubble.role === "body" ? 0.12 : 0.24) : SDF_MAX_BUBBLE_SPEED;
        clampSdfBubbleSpeed(bubble, maxSpeed);
        bubble.pos.addScaledVector(bubble.vel, stepDt);

        if (aquarium && bubble.role === "riser") {
          // Freeze aging during a gesture so a gathered puff cannot teleport out
          // of the user's hand. Recycling only happens after it is invisible.
          const lifetime = (0.14 + bubble.seed * 0.23) / getAquariumRiseSpeed(settings.animationSpeed);
          bubble.age = (bubble.age / bubble.lifetime) * lifetime + stepDt * (1 - bubble.interaction);
          bubble.lifetime = lifetime;
          updateAquariumBubbleAppearance(bubble, time);
          if (bubble.age >= bubble.lifetime) {
            resetAquariumBubble(bubble, aquariumEmitters.current, settings);
          }
        }
      }

      for (let i = 0; i < bubbleCount; i += 1) {
        const a = bubbles.current[i];
        if (grabbedBubbles.has(i) || a.opacity < 0.1 || a.interaction > 0.35) continue;
        for (let j = i + 1; j < bubbleCount; j += 1) {
          const b = bubbles.current[j];
          if (grabbedBubbles.has(j) || b.opacity < 0.1 || b.interaction > 0.35) continue;
          if (a.role !== b.role || a.satellite || b.satellite) continue;
          resolveSdfSphereCollision(a, b, a.role === "body" ? 0.5 : 0.85, 0.12);
        }
      }
    }

    const uniforms = material.uniforms.uBubbles.value as THREE.Vector4[];
    for (let index = 0; index < bubbleCount; index += 1) {
      const bubble = bubbles.current[index];
      // Also fade before reaching the drawing plane so throws never cut off hard.
      const edgeFade = 1 - THREE.MathUtils.smoothstep(
        Math.max(Math.abs(bubble.pos.x), Math.abs(bubble.pos.y)), 0.86, 0.98
      );
      uniforms[index].set(bubble.pos.x, bubble.pos.y, bubble.radius, bubble.opacity * edgeFade);
    }
    material.uniforms.uBubbleCount.value = bubbleCount;
    material.uniforms.uFlicker.value = settings.flicker;
    material.uniforms.uColorPrimary.value.set(settings.particleColor);
    material.uniforms.uColorAccent.value.set(settings.particleAccentColor);
    material.uniforms.uColorHighlight.value.set(settings.particleHighlightColor);
  });

  if (!material) {
    return null;
  }

  return (
    <mesh
      material={material}
      scale={[SURFACE_PLANE_WORLD_SIZE, SURFACE_PLANE_WORLD_SIZE, 1]}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

function createSdfBubble(
  index: number,
  activeBubbleCount: number,
  origins: THREE.Vector2[],
  settings: ParticleSettings,
  bodyAnchor?: THREE.Vector2
): SdfBubble {
  const aquarium = settings.sdfMotionMode === "aquarium";
  const sizeScale = getSdfBubbleSizeScale(settings.pointSize, activeBubbleCount);
  const isBody = index < getSdfBodyCount(activeBubbleCount);
  const role: SdfBubbleRole = isBody ? "body" : "riser";
  const satellite = !aquarium && !isBody;
  const origin = bodyAnchor ?? origins[(index * 37) % Math.max(1, origins.length)] ?? new THREE.Vector2();
  const pos = origin.clone();
  const baseRadius = satellite
    ? (0.003 + Math.random() * 0.004) * sizeScale
    : createSdfBaseRadius(sizeScale, role);
  const seed = Math.random() + index * 0.013;
  const cycle = createSdfBubbleCycle(seed + pos.x * 0.3);

  return {
    pos,
    vel: new THREE.Vector2(),
    radius: baseRadius,
    baseRadius,
    seed,
    cycleRate: cycle.cycleRate,
    cyclePhase: cycle.cyclePhase,
    age: 0,
    lifetime: 1,
    opacity: 1,
    interaction: 0,
    role,
    anchorX: pos.x,
    anchorY: pos.y,
    satellite
  };
}

function resolveSdfSphereCollision(
  a: { pos: THREE.Vector2; vel: THREE.Vector2; radius: number },
  b: { pos: THREE.Vector2; vel: THREE.Vector2; radius: number },
  separation = 0.45,
  restitution = 0.65
) {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const distSq = dx * dx + dy * dy;
  const radiusSum = (a.radius + b.radius) * separation;

  if (distSq >= radiusSum * radiusSum || distSq <= 0.000001) {
    return;
  }

  const dist = Math.sqrt(distSq);
  const overlap = radiusSum - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  const push = overlap * 0.5;

  a.pos.x += nx * push;
  a.pos.y += ny * push;
  b.pos.x -= nx * push;
  b.pos.y -= ny * push;

  const relativeVelocity = (a.vel.x - b.vel.x) * nx + (a.vel.y - b.vel.y) * ny;

  if (relativeVelocity < 0) {
    const impulse = relativeVelocity * restitution;
    a.vel.x -= nx * impulse;
    a.vel.y -= ny * impulse;
    b.vel.x += nx * impulse;
    b.vel.y += ny * impulse;
  }
}

function useSvgMaskTexture(svgText: string, maskRoughness: number) {
  const texture = useMemo(() => {
    const canvas = createSurfaceMaskCanvas(svgText, maskRoughness);

    if (!canvas) {
      return null;
    }

    const nextTexture = new THREE.CanvasTexture(canvas);
    nextTexture.minFilter = THREE.LinearFilter;
    nextTexture.magFilter = THREE.LinearFilter;
    nextTexture.wrapS = THREE.ClampToEdgeWrapping;
    nextTexture.wrapT = THREE.ClampToEdgeWrapping;
    nextTexture.generateMipmaps = false;
    nextTexture.needsUpdate = true;

    return nextTexture;
  }, [maskRoughness, svgText]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  return texture;
}

function createSurfaceMaskCanvas(svgText: string, maskRoughness: number) {
  const roughness = Math.min(1, Math.max(0, maskRoughness));
  const cachedMask = getSurfaceMaskCacheEntry(svgText);
  const vectorMask = cachedMask.vector;

  if (vectorMask && roughness <= 0.001) {
    return vectorMask;
  }

  if (!cachedMask.sampled && roughness > 0.001) {
    cachedMask.sampled = createSampledSurfaceMaskCanvas(svgText);
  }

  const sampledMask = cachedMask.sampled;

  if (!vectorMask) {
    return sampledMask;
  }

  if (!sampledMask) {
    return vectorMask;
  }

  if (roughness >= 0.999) {
    return sampledMask;
  }

  return blendSurfaceMaskCanvases(vectorMask, sampledMask, roughness);
}

function getSurfaceMaskCacheEntry(svgText: string) {
  const cachedMask = surfaceMaskCanvasCache.get(svgText);

  if (cachedMask) {
    return cachedMask;
  }

  const nextMask = {
    vector: createVectorSurfaceMaskCanvas(svgText),
    sampled: null
  };

  if (surfaceMaskCanvasCache.size > 8) {
    const oldestKey = surfaceMaskCanvasCache.keys().next().value;

    if (oldestKey) {
      surfaceMaskCanvasCache.delete(oldestKey);
    }
  }

  surfaceMaskCanvasCache.set(svgText, nextMask);
  return nextMask;
}

function blendSurfaceMaskCanvases(
  vectorMask: HTMLCanvasElement,
  sampledMask: HTMLCanvasElement,
  roughness: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = SURFACE_TEXTURE_SIZE;
  canvas.height = SURFACE_TEXTURE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return roughness > 0.5 ? sampledMask : vectorMask;
  }

  context.clearRect(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
  context.drawImage(vectorMask, 0, 0);
  const vectorImage = context.getImageData(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
  context.clearRect(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
  context.drawImage(sampledMask, 0, 0);
  const sampledImage = context.getImageData(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
  const outputImage = context.createImageData(SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
  const cleanWeight = 1 - roughness;

  for (let index = 0; index < outputImage.data.length; index += 4) {
    const vectorAlpha = vectorImage.data[index + 3] / 255;
    const sampledAlpha = sampledImage.data[index + 3] / 255;
    const mixedAlpha = vectorAlpha * cleanWeight + sampledAlpha * roughness;
    const value = Math.round(Math.min(1, Math.max(0, mixedAlpha)) * 255);

    outputImage.data[index] = value;
    outputImage.data[index + 1] = value;
    outputImage.data[index + 2] = value;
    outputImage.data[index + 3] = value;
  }

  context.putImageData(outputImage, 0, 0);
  return canvas;
}

function createSampledSurfaceMaskCanvas(svgText: string) {
  try {
    const buffers = sampleSvgToParticles(svgText, 52000, 47);
    const rawCanvas = document.createElement("canvas");
    rawCanvas.width = SURFACE_TEXTURE_SIZE;
    rawCanvas.height = SURFACE_TEXTURE_SIZE;
    const rawContext = rawCanvas.getContext("2d");

    if (!rawContext) {
      return null;
    }

    rawContext.clearRect(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
    rawContext.fillStyle = "#ffffff";

    for (let index = 0; index < buffers.count; index += 1) {
      const x =
        (buffers.positions[index * 3] / LOGO_CONTENT_WORLD_SIZE + 0.5) *
        SURFACE_TEXTURE_SIZE;
      const y =
        (0.5 - buffers.positions[index * 3 + 1] / LOGO_CONTENT_WORLD_SIZE) *
        SURFACE_TEXTURE_SIZE;
      const radius = buffers.intensities[index] > 0.86 ? 2.3 : 1.75;
      rawContext.globalAlpha = buffers.intensities[index] > 0.86 ? 0.82 : 0.46;
      rawContext.fillRect(x - radius * 0.5, y - radius * 0.5, radius, radius);
    }

    rawContext.globalAlpha = 1;

    const canvas = document.createElement("canvas");
    canvas.width = SURFACE_TEXTURE_SIZE;
    canvas.height = SURFACE_TEXTURE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return rawCanvas;
    }

    context.clearRect(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
    context.filter = "blur(1.1px)";
    context.drawImage(rawCanvas, 0, 0);
    context.filter = "none";
    context.globalCompositeOperation = "source-over";
    context.drawImage(rawCanvas, 0, 0);

    return canvas;
  } catch (error) {
    console.warn("Sampled SVG surface mask generation failed.", error);
    return null;
  }
}

function createVectorSurfaceMaskCanvas(svgText: string) {
  try {
    const loader = new SVGLoader();
    const svg = loader.parse(ensureSvgXmlns(svgText));
    const fillShapes: THREE.Shape[] = [];
    const strokes: Array<{
      points: THREE.Vector2[];
      style: StrokeStyle;
    }> = [];
    const bounds = new THREE.Box2();

    svg.paths.forEach((path) => {
      const style = getSvgPathStyle(path);

      if (hasVisibleFill(style)) {
        SVGLoader.createShapes(path).forEach((shape) => {
          fillShapes.push(shape);
          expandBoundsFromShape(bounds, shape);
        });
      }

      const strokeStyle = getVisibleStrokeStyle(style);

      if (strokeStyle) {
        path.subPaths.forEach((subPath) => {
          const length = Math.max(1, subPath.getLength());
          const points = subPath.getSpacedPoints(Math.min(960, Math.max(32, Math.ceil(length / 1.8))));

          if (points.length < 2) {
            return;
          }

          points.forEach((point) => bounds.expandByPoint(point));
          strokes.push({ points, style: strokeStyle });
        });
      }
    });

    if (bounds.isEmpty()) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = SURFACE_TEXTURE_SIZE;
    canvas.height = SURFACE_TEXTURE_SIZE;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    const size = new THREE.Vector2();
    const center = new THREE.Vector2();
    bounds.getSize(size);
    bounds.getCenter(center);

    const drawScale =
      (SURFACE_TEXTURE_SIZE * SURFACE_MASK_FILL_RATIO) / Math.max(size.x, size.y, 1);
    const toCanvasPoint = (point: THREE.Vector2) => ({
      x: (point.x - center.x) * drawScale + SURFACE_TEXTURE_SIZE * 0.5,
      y: (point.y - center.y) * drawScale + SURFACE_TEXTURE_SIZE * 0.5
    });
    const traceContour = (points: THREE.Vector2[]) => {
      if (points.length === 0) {
        return;
      }

      const first = toCanvasPoint(points[0]);
      context.moveTo(first.x, first.y);
      points.slice(1).forEach((point) => {
        const next = toCanvasPoint(point);
        context.lineTo(next.x, next.y);
      });
      context.closePath();
    };

    context.clearRect(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";

    fillShapes.forEach((shape) => {
      const extracted = shape.extractPoints(72);
      context.beginPath();
      traceContour(extracted.shape);
      extracted.holes.forEach(traceContour);
      context.fill("evenodd");
    });

    strokes.forEach(({ points, style }) => {
      const first = toCanvasPoint(points[0]);
      context.beginPath();
      context.moveTo(first.x, first.y);
      points.slice(1).forEach((point) => {
        const next = toCanvasPoint(point);
        context.lineTo(next.x, next.y);
      });
      context.lineWidth = Math.max(2.2, Number(style.strokeWidth) * drawScale);
      context.lineCap = String(style.strokeLineCap ?? "round") as CanvasLineCap;
      context.lineJoin = String(style.strokeLineJoin ?? "round") as CanvasLineJoin;
      context.miterLimit = Number(style.strokeMiterLimit ?? 4);
      context.stroke();
    });

    return canvas;
  } catch (error) {
    console.warn("SVG surface mask generation failed.", error);
    return null;
  }
}

function ensureSvgXmlns(svgText: string) {
  if (/<svg[^>]+xmlns=/i.test(svgText)) {
    return svgText;
  }

  return svgText.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function getSvgAspect(svgText: string) {
  const viewBoxMatch = svgText.match(
    /\bviewBox=["']\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s*["']/i
  );

  if (viewBoxMatch) {
    const width = Number(viewBoxMatch[3]);
    const height = Number(viewBoxMatch[4]);

    if (width > 0 && height > 0) {
      return width / height;
    }
  }

  const width = parseSvgLength(svgText.match(/\bwidth=["']([^"']+)["']/i)?.[1]);
  const height = parseSvgLength(svgText.match(/\bheight=["']([^"']+)["']/i)?.[1]);

  if (width && height) {
    return width / height;
  }

  return 320 / 220;
}

function parseSvgLength(value?: string) {
  if (!value || value.includes("%")) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getAsciiCharacters(value: string) {
  const characters = Array.from(value)
    .map((character) => character.trim())
    .filter(Boolean)
    .slice(0, ASCII_ATLAS_MAX_CHARACTERS);

  return characters.length > 0 ? characters.join("") : DEFAULT_ASCII_CHARACTERS;
}

function getAsciiRasterCharacters(value: string) {
  const characters = Array.from(value).filter((character) => character !== "\n" && character !== "\r");
  return characters.length > 0
    ? characters.slice(0, 96).join("")
    : DEFAULT_ASCII_RASTER_CHARACTERS;
}

function FancyLetterOverlay({
  svgText,
  settings,
  replayNonce,
  paused
}: {
  svgText: string;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const model = useMemo(() => createFancyLetterModel(svgText), [svgText]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const durationMs = Math.max(420, 1350 / Math.max(0.2, settings.animationSpeed));
  const hoverDurationMs = Math.max(150, durationMs / (1 + settings.mouseForce * 2.4));
  const layerIndexes = useMemo(
    () => getFancyVariantLayerIndexes(settings.fancyVariant),
    [settings.fancyVariant]
  );
  const motionDurationSeconds = Math.max(0.32, durationMs / 1000);
  const wrapperStyle = {
    "--fancy-primary": settings.particleColor,
    "--fancy-accent": settings.particleAccentColor,
    "--fancy-highlight": settings.particleHighlightColor,
    "--fancy-stroke": `${settings.pointSize}px`,
    "--fancy-stagger": `${70 + settings.scatterRadius * 150}ms`,
    "--fancy-layer-delay": `${65 + settings.attractRadius * 180}ms`,
    "--fancy-duration": `${durationMs}ms`,
    "--fancy-hover-duration": `${hoverDurationMs}ms`,
    "--fancy-active-duration": `${durationMs}ms`,
    "--fancy-layer-spread": `${settings.repelRadius * 5}px`,
    "--fancy-bounce-y": `${-58 * settings.turbulence}px`,
    "--fancy-bounce-rot": `${-22 * settings.turbulence}deg`,
    "--fancy-under-opacity": `${Math.max(0, Math.min(1, 1 - settings.flicker))}`,
    "--fancy-float": `${settings.breathe * 12}px`
  } as CSSProperties & Record<string, string>;

  return (
    <div
      ref={overlayRef}
      key={`fancy-${settings.fancyVariant}-${replayNonce}-${model.paths.length}`}
      className={`fancy-letter-overlay fancy-variant-${settings.fancyVariant} ${
        paused ? "is-paused" : ""
      }`}
      style={wrapperStyle}
      onPointerEnter={(event) => {
        event.currentTarget.style.setProperty("--fancy-active-duration", `${hoverDurationMs}ms`);
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--fancy-active-duration", `${durationMs}ms`);
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.setProperty("--fancy-active-duration", `${hoverDurationMs}ms`);
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.setProperty("--fancy-active-duration", `${durationMs}ms`);
      }}
      aria-hidden="true"
    >
      {model.paths.length > 0 ? (
        <svg
          className="fancy-letter-svg"
          viewBox={model.viewBox}
          preserveAspectRatio="xMidYMid meet"
        >
          {model.paths.map((path, pathIndex) => (
            <g
              key={`${path.d}-${pathIndex}`}
              className="fancy-letter-part"
              style={{ "--part-index": pathIndex } as CSSProperties & Record<string, number>}
            >
              {layerIndexes.map((layerIndex) => (
                <path
                  key={layerIndex}
                  className={`fancy-letter-layer fancy-letter-layer-${layerIndex % 3} fancy-variant-layer-${layerIndex}`}
                  d={path.d}
                  transform={path.transform}
                  pathLength={1}
                  style={
                    {
                      "--layer-index": layerIndex,
                      "--path-order": pathIndex % 5
                    } as CSSProperties & Record<string, number>
                  }
                />
              ))}
              {settings.fancyVariant === "effect3" && pathIndex < 36 && (
                <circle
                  className="fancy-letter-head"
                  r="1.35"
                  transform={path.transform}
                  style={
                    {
                      "--part-index": pathIndex
                    } as CSSProperties & Record<string, number>
                  }
                >
                  <animateMotion
                    dur={`${motionDurationSeconds}s`}
                    path={path.d}
                    repeatCount="indefinite"
                    rotate="auto"
                  />
                </circle>
              )}
            </g>
          ))}
        </svg>
      ) : (
        <div className="fancy-letter-empty">NO PATH DATA</div>
      )}
    </div>
  );
}

function getFancyVariantLayerIndexes(variant: ParticleSettings["fancyVariant"]) {
  if (variant === "effect2") {
    return [0, 1, 2, 3];
  }

  if (variant === "effect3") {
    return [0, 1];
  }

  if (variant === "effect4") {
    return [0, 1, 2, 3, 4];
  }

  return [0, 1, 2];
}

function AsciiRasterOverlay({
  svgText,
  settings,
  replayNonce,
  paused
}: {
  svgText: string;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const frameRef = useRef<number | null>(null);
  const mouse = useRef({ x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 });
  const sourceMask = useMemo(() => createSurfaceMaskCanvas(svgText, 0), [svgText]);
  const rasterCanvas = useMemo(() => document.createElement("canvas"), []);
  const tempCanvas = useMemo(() => document.createElement("canvas"), []);
  const rasterContext = useMemo(
    () => rasterCanvas.getContext("2d", { willReadFrequently: true }),
    [rasterCanvas]
  );
  const tempContext = useMemo(() => tempCanvas.getContext("2d"), [tempCanvas]);

  useEffect(() => {
    const container = containerRef.current;
    const pre = preRef.current;

    if (!container || !pre || !sourceMask || !rasterContext || !tempContext) {
      if (pre) {
        pre.textContent = "INVALID SVG";
      }
      return;
    }

    const characters = getAsciiRasterCharacters(settings.asciiCharacters);
    const startAt = performance.now();
    let lastRasterAt = 0;

    const renderFrame = (now: number) => {
      const bounds = container.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const charSize = Math.max(5, Math.min(18, settings.pointSize));
      const cellWidth = charSize * 0.62;
      const cols = Math.max(18, Math.min(220, Math.floor(width / cellWidth)));
      const rows = Math.max(12, Math.min(150, Math.floor(height / charSize)));

      rasterCanvas.width = cols;
      rasterCanvas.height = rows;
      tempCanvas.width = cols;
      tempCanvas.height = rows;

      const time = (now - startAt) * 0.001 * Math.max(0.05, settings.animationSpeed);
      const pointer = mouse.current;
      pointer.x += (pointer.targetX - pointer.x) * 0.075;
      pointer.y += (pointer.targetY - pointer.y) * 0.075;

      rasterContext.clearRect(0, 0, cols, rows);
      tempContext.clearRect(0, 0, cols, rows);
      tempContext.imageSmoothingEnabled = true;

      const scaleControl = Math.max(0.45, Math.min(1.6, settings.scatterRadius / 8));
      const maskSize = Math.min(cols * 1.35, rows * 1.55) * scaleControl;
      const centerPulse = Math.sin(time * 1.3) * settings.breathe * 0.14 + 1;
      const drawSize = maskSize * centerPulse;
      const centerX = cols * (0.5 + (pointer.x - 0.5) * settings.mouseForce * 0.018);
      const centerY = rows * (0.5 + (pointer.y - 0.5) * settings.mouseForce * 0.016);

      tempContext.globalAlpha = 1;
      tempContext.drawImage(
        sourceMask,
        centerX - drawSize * 0.5,
        centerY - drawSize * 0.5,
        drawSize,
        drawSize
      );

      const split = settings.repelRadius * 1.9;
      const tiltX = (pointer.x - 0.5) * settings.mouseForce * 2.2;
      const tiltY = (pointer.y - 0.5) * settings.mouseForce * 1.1;
      const passes = [
        { offset: -split, alpha: 0.28 },
        { offset: split, alpha: 0.24 },
        { offset: 0, alpha: 0.98 }
      ];

      rasterContext.globalCompositeOperation = "lighter";
      passes.forEach((pass, passIndex) => {
        rasterContext.globalAlpha = pass.alpha;

        for (let row = 0; row < rows; row += 1) {
          const rowRatio = row / Math.max(1, rows - 1);
          const wave =
            Math.sin(time * 1.8 + rowRatio * 12.0 + passIndex * 1.7) *
            settings.turbulence *
            (1.25 + rowRatio * 0.7);
          const ribbon =
            Math.cos(time * 1.15 + rowRatio * 7.5 + pointer.y * 3.2) *
            settings.turbulence *
            0.18;
          rasterContext.drawImage(
            tempCanvas,
            0,
            row,
            cols,
            1,
            wave + pass.offset + tiltX,
            row + ribbon + tiltY,
            cols,
            1
          );
        }
      });
      rasterContext.globalCompositeOperation = "source-over";
      rasterContext.globalAlpha = 1;

      const image = rasterContext.getImageData(0, 0, cols, rows).data;
      const maxChar = Math.max(1, characters.length - 1);
      let output = "";

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < cols; column += 1) {
          const index = (row * cols + column) * 4;
          const alpha = image[index + 3] / 255;
          const luminance = (image[index] + image[index + 1] + image[index + 2]) / 765;
          const noise =
            fract(Math.sin(column * 12.9898 + row * 78.233 + time * 24.173) * 43758.5453) -
            0.5;
          const contrast = 0.72 + settings.flicker * 0.62;
          const brightness = Math.max(
            0,
            Math.min(1, Math.pow(alpha * (0.35 + luminance), 1 / contrast) + noise * 0.08)
          );

          if (brightness < 0.045) {
            output += " ";
            continue;
          }

          output += characters[Math.min(maxChar, Math.floor(brightness * maxChar))];
        }
        output += "\n";
      }

      pre.textContent = output;
      pre.style.fontSize = `${charSize}px`;
      pre.style.lineHeight = `${charSize}px`;
      pre.style.setProperty("--ascii-x", `${pointer.x * 100}%`);
      pre.style.setProperty("--ascii-y", `${pointer.y * 100}%`);
      pre.style.setProperty("--ascii-primary", settings.particleColor);
      pre.style.setProperty("--ascii-accent", settings.particleAccentColor);
      pre.style.setProperty("--ascii-hot", settings.particleHighlightColor);
      pre.style.filter = `hue-rotate(${
        (pointer.x - 0.5) * settings.attractRadius * 80 + Math.sin(time * 0.4) * 8
      }deg)`;
      pre.style.transform = `perspective(980px) rotateX(${
        (0.5 - pointer.y) * settings.mouseForce * 5
      }deg) rotateY(${(pointer.x - 0.5) * settings.mouseForce * 7}deg)`;
    };

    if (paused) {
      renderFrame(performance.now());
      return;
    }

    const loop = (now: number) => {
      if (now - lastRasterAt > 34) {
        lastRasterAt = now;
        renderFrame(now);
      }

      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    paused,
    rasterCanvas,
    rasterContext,
    replayNonce,
    settings,
    sourceMask,
    tempCanvas,
    tempContext
  ]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    mouse.current.targetX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    mouse.current.targetY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
  };

  return (
    <div
      ref={containerRef}
      className="ascii-raster-overlay"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        mouse.current.targetX = 0.5;
        mouse.current.targetY = 0.5;
      }}
      aria-hidden="true"
    >
      <pre ref={preRef} className="ascii-raster-output" />
    </div>
  );
}

function fract(value: number) {
  return value - Math.floor(value);
}

function createFancyLetterModel(svgText: string): FancyLetterModel {
  const fallbackModel = {
    viewBox: "0 0 320 180",
    paths: []
  };

  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(ensureSvgXmlns(svgText), "image/svg+xml");
    const svg = document.querySelector("svg");

    if (!svg || document.querySelector("parsererror")) {
      return fallbackModel;
    }

    const width = parseSvgLength(svg.getAttribute("width") ?? undefined) ?? 320;
    const height = parseSvgLength(svg.getAttribute("height") ?? undefined) ?? 180;
    const viewBox = svg.getAttribute("viewBox") ?? `0 0 ${width} ${height}`;
    const paths: FancyLetterPath[] = [];

    collectFancyLetterPaths(svg, "", paths);

    return {
      viewBox,
      paths: paths.slice(0, 180)
    };
  } catch (error) {
    console.warn("Fancy SVG path extraction failed.", error);
    return fallbackModel;
  }
}

function collectFancyLetterPaths(
  element: Element,
  parentTransform: string,
  paths: FancyLetterPath[]
) {
  const tagName = element.tagName.toLowerCase();

  if (isNonRenderableSvgElement(tagName) || !isRenderableSvgElement(element)) {
    return;
  }

  const localTransform = sanitizeSvgTransform(element.getAttribute("transform"));
  const transform = [parentTransform, localTransform].filter(Boolean).join(" ");
  const d = getFancyElementPathData(element, tagName);

  if (d) {
    paths.push({
      d,
      transform: transform || undefined
    });
  }

  Array.from(element.children).forEach((child) => {
    collectFancyLetterPaths(child, transform, paths);
  });
}

function isNonRenderableSvgElement(tagName: string) {
  return (
    tagName === "defs" ||
    tagName === "clipPath" ||
    tagName === "mask" ||
    tagName === "pattern" ||
    tagName === "filter" ||
    tagName === "linearGradient" ||
    tagName === "radialGradient" ||
    tagName === "style" ||
    tagName === "title" ||
    tagName === "desc" ||
    tagName === "metadata" ||
    tagName === "script"
  );
}

function isRenderableSvgElement(element: Element) {
  const display = element.getAttribute("display")?.trim().toLowerCase();
  const visibility = element.getAttribute("visibility")?.trim().toLowerCase();
  const opacity = Number.parseFloat(element.getAttribute("opacity") ?? "1");

  return display !== "none" && visibility !== "hidden" && (!Number.isFinite(opacity) || opacity > 0);
}

function getFancyElementPathData(element: Element, tagName: string) {
  if (tagName === "path") {
    const d = element.getAttribute("d")?.trim();
    return d && d.length < 12000 ? d : null;
  }

  if (tagName === "line") {
    const x1 = parseSvgNumber(element.getAttribute("x1"));
    const y1 = parseSvgNumber(element.getAttribute("y1"));
    const x2 = parseSvgNumber(element.getAttribute("x2"));
    const y2 = parseSvgNumber(element.getAttribute("y2"));
    return `M${x1} ${y1}L${x2} ${y2}`;
  }

  if (tagName === "polyline" || tagName === "polygon") {
    const points = parseSvgPoints(element.getAttribute("points"));

    if (points.length < 2) {
      return null;
    }

    const commands = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
      .join("");
    return tagName === "polygon" ? `${commands}Z` : commands;
  }

  if (tagName === "rect") {
    const x = parseSvgNumber(element.getAttribute("x"));
    const y = parseSvgNumber(element.getAttribute("y"));
    const width = Math.max(0, parseSvgNumber(element.getAttribute("width")));
    const height = Math.max(0, parseSvgNumber(element.getAttribute("height")));
    const rx = Math.min(width * 0.5, Math.max(0, parseSvgNumber(element.getAttribute("rx"))));
    const ry = Math.min(height * 0.5, Math.max(0, parseSvgNumber(element.getAttribute("ry")) || rx));

    if (width <= 0 || height <= 0) {
      return null;
    }

    if (rx <= 0 && ry <= 0) {
      return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
    }

    return [
      `M${x + rx} ${y}`,
      `H${x + width - rx}`,
      `Q${x + width} ${y} ${x + width} ${y + ry}`,
      `V${y + height - ry}`,
      `Q${x + width} ${y + height} ${x + width - rx} ${y + height}`,
      `H${x + rx}`,
      `Q${x} ${y + height} ${x} ${y + height - ry}`,
      `V${y + ry}`,
      `Q${x} ${y} ${x + rx} ${y}`,
      "Z"
    ].join("");
  }

  if (tagName === "circle" || tagName === "ellipse") {
    const cx = parseSvgNumber(element.getAttribute("cx"));
    const cy = parseSvgNumber(element.getAttribute("cy"));
    const rx =
      tagName === "circle"
        ? parseSvgNumber(element.getAttribute("r"))
        : parseSvgNumber(element.getAttribute("rx"));
    const ry =
      tagName === "circle"
        ? parseSvgNumber(element.getAttribute("r"))
        : parseSvgNumber(element.getAttribute("ry"));

    if (rx <= 0 || ry <= 0) {
      return null;
    }

    return [
      `M${cx - rx} ${cy}`,
      `A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
      `A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
      "Z"
    ].join("");
  }

  return null;
}

function parseSvgNumber(value: string | null) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSvgPoints(value: string | null) {
  if (!value) {
    return [];
  }

  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter(Number.isFinite);
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < numbers.length - 1; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }

  return points;
}

function sanitizeSvgTransform(value: string | null) {
  if (!value || !/^[a-z0-9,.\-+\s()]+$/i.test(value)) {
    return "";
  }

  return value;
}

function createAsciiGlyphAtlas(characters: string) {
  const cellSize = 64;
  const canvas = document.createElement("canvas");
  canvas.width = ASCII_ATLAS_COLUMNS * cellSize;
  canvas.height = ASCII_ATLAS_ROWS * cellSize;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create ASCII glyph atlas.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "500 42px SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace";

  Array.from(characters).forEach((character, index) => {
    const column = index % ASCII_ATLAS_COLUMNS;
    const row = Math.floor(index / ASCII_ATLAS_COLUMNS);
    context.fillText(character, column * cellSize + cellSize / 2, row * cellSize + cellSize / 2 + 1);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;

  return texture;
}

function AsciiGlyphParticles({
  buffers,
  settings,
  replayNonce,
  paused
}: {
  buffers: ParticleBuffers;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const resetOnNextFrame = useRef(true);
  const startTime = useRef(0);
  const runningTime = useRef(0);
  const lastPointerAt = useRef(-Infinity);
  const mouseField = useRef(0);
  const smoothedMouse = useRef(new THREE.Vector2(20, 20));
  const targetMouse = useRef(new THREE.Vector2(20, 20));
  const asciiCharacters = useMemo(
    () => getAsciiCharacters(settings.asciiCharacters),
    [settings.asciiCharacters]
  );
  const glyphAtlas = useMemo(
    () => createAsciiGlyphAtlas(asciiCharacters),
    [asciiCharacters]
  );

  const material = useMemo(() => {
    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uGlyphAtlas: { value: glyphAtlas },
        uGlyphCount: { value: asciiCharacters.length },
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uGlyphSize: { value: 0.08 },
        uScatter: { value: settings.scatterRadius },
        uTurbulence: { value: settings.turbulence },
        uMouseForce: { value: settings.mouseForce },
        uMouseActive: { value: 0 },
        uAttractRadius: { value: settings.attractRadius },
        uRepelRadius: { value: settings.repelRadius },
        uFlicker: { value: settings.flicker },
        uBreathe: { value: settings.breathe },
        uBirthPulse: { value: 0 },
        uColorPrimary: { value: new THREE.Color(settings.particleColor) },
        uColorAccent: { value: new THREE.Color(settings.particleAccentColor) },
        uColorHighlight: { value: new THREE.Color(settings.particleHighlightColor) },
        uMouse: { value: new THREE.Vector2(20, 20) }
      },
      vertexShader: asciiParticleVertexShader,
      fragmentShader: asciiParticleFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    shaderMaterial.toneMapped = false;
    return shaderMaterial;
  }, []);

  const geometry = useMemo(() => {
    const nextGeometry = new THREE.InstancedBufferGeometry();
    const quadPositions = new Float32Array([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0
    ]);
    const quadUvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const glyphs = new Float32Array(buffers.count);
    const glyphCount = Math.max(1, asciiCharacters.length);

    for (let index = 0; index < buffers.count; index += 1) {
      const raw = buffers.seeds[index] * 0.031 + buffers.intensities[index] * 1.73;
      glyphs[index] = Math.floor((raw - Math.floor(raw)) * glyphCount);
    }

    nextGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    nextGeometry.setAttribute("position", new THREE.BufferAttribute(quadPositions, 3));
    nextGeometry.setAttribute("uv", new THREE.BufferAttribute(quadUvs, 2));
    nextGeometry.setAttribute(
      "aTarget",
      new THREE.InstancedBufferAttribute(buffers.positions, 3)
    );
    nextGeometry.setAttribute(
      "aOrigin",
      new THREE.InstancedBufferAttribute(buffers.origins, 3)
    );
    nextGeometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(buffers.seeds, 1));
    nextGeometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(buffers.sizes, 1));
    nextGeometry.setAttribute("aDelay", new THREE.InstancedBufferAttribute(buffers.delays, 1));
    nextGeometry.setAttribute(
      "aIntensity",
      new THREE.InstancedBufferAttribute(buffers.intensities, 1)
    );
    nextGeometry.setAttribute("aGlyph", new THREE.InstancedBufferAttribute(glyphs, 1));
    nextGeometry.instanceCount = buffers.count;

    return nextGeometry;
  }, [asciiCharacters.length, buffers]);

  useEffect(() => {
    resetOnNextFrame.current = true;
  }, [replayNonce]);

  useEffect(() => {
    material.uniforms.uGlyphAtlas.value = glyphAtlas;
    material.uniforms.uGlyphCount.value = asciiCharacters.length;
    resetOnNextFrame.current = true;
  }, [asciiCharacters.length, glyphAtlas, material]);

  useEffect(() => {
    const canvas = gl.domElement;
    const activateMouse = () => {
      lastPointerAt.current = performance.now() / 1000;
    };
    const deactivateMouse = () => {
      mouseField.current = 0;
    };

    canvas.addEventListener("pointermove", activateMouse);
    canvas.addEventListener("pointerdown", activateMouse);
    canvas.addEventListener("pointerleave", deactivateMouse);
    window.addEventListener("blur", deactivateMouse);

    return () => {
      canvas.removeEventListener("pointermove", activateMouse);
      canvas.removeEventListener("pointerdown", activateMouse);
      canvas.removeEventListener("pointerleave", deactivateMouse);
      window.removeEventListener("blur", deactivateMouse);
    };
  }, [gl]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      glyphAtlas.dispose();
    };
  }, [glyphAtlas]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((state, delta) => {
    if (paused) {
      return;
    }

    runningTime.current += delta;

    if (resetOnNextFrame.current) {
      startTime.current = runningTime.current;
      resetOnNextFrame.current = false;
    }

    const elapsed = runningTime.current - startTime.current;
    const progress = Math.min(1, elapsed * 0.46 * settings.animationSpeed);
    const birthPulse = Math.sin(progress * Math.PI) * (1 - progress * 0.12);
    const viewport = state.viewport;

    targetMouse.current.set(
      state.pointer.x * viewport.width * 0.5,
      state.pointer.y * viewport.height * 0.5
    );
    smoothedMouse.current.lerp(targetMouse.current, 1 - Math.exp(-delta * 8.5));

    const secondsSincePointer = performance.now() / 1000 - lastPointerAt.current;
    const targetField = Math.exp(-Math.max(0, secondsSincePointer - 0.1) * 2.2);
    mouseField.current += (targetField - mouseField.current) * (1 - Math.exp(-delta * 4.8));

    material.uniforms.uTime.value = runningTime.current;
    material.uniforms.uProgress.value = progress;
    material.uniforms.uGlyphSize.value = Math.max(
      0.045,
      Math.min(0.13, 0.034 + settings.pointSize * 0.016)
    );
    material.uniforms.uScatter.value = settings.scatterRadius;
    material.uniforms.uTurbulence.value = settings.turbulence;
    material.uniforms.uMouseForce.value = settings.mouseForce;
    material.uniforms.uMouseActive.value = mouseField.current;
    material.uniforms.uAttractRadius.value = settings.attractRadius;
    material.uniforms.uRepelRadius.value = settings.repelRadius;
    material.uniforms.uFlicker.value = settings.flicker;
    material.uniforms.uBreathe.value = settings.breathe;
    material.uniforms.uBirthPulse.value = Math.max(0, birthPulse);
    material.uniforms.uColorPrimary.value.set(settings.particleColor);
    material.uniforms.uColorAccent.value.set(settings.particleAccentColor);
    material.uniforms.uColorHighlight.value.set(settings.particleHighlightColor);
    material.uniforms.uMouse.value.copy(smoothedMouse.current);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

function ParticleCloud({
  buffers,
  buffersB,
  morphBlend = 0,
  settings,
  replayNonce,
  paused
}: {
  buffers: ParticleBuffers;
  buffersB?: ParticleBuffers | null;
  morphBlend?: number;
  settings: ParticleSettings;
  replayNonce: number;
  paused: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const resetOnNextFrame = useRef(true);
  const startTime = useRef(0);
  const runningTime = useRef(0);
  const lastPointerAt = useRef(-Infinity);
  const mouseField = useRef(0);
  const smoothedMouse = useRef(new THREE.Vector2(20, 20));
  const targetMouse = useRef(new THREE.Vector2(20, 20));
  const material = useMemo(() => {
    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uPointSize: { value: settings.pointSize },
        uScatter: { value: settings.scatterRadius },
        uTurbulence: { value: settings.turbulence },
        uMouseForce: { value: settings.mouseForce },
        uMouseActive: { value: 0 },
        uAttractRadius: { value: settings.attractRadius },
        uRepelRadius: { value: settings.repelRadius },
        uFlicker: { value: settings.flicker },
        uBreathe: { value: settings.breathe },
        uBirthPulse: { value: 0 },
        uDpr: { value: 1 },
        uStyle: { value: getStyleIndex(settings.logoStyle) },
        uMotionSpeed: { value: settings.animationSpeed },
        uMorph: { value: 0 },
        uColorPrimary: { value: new THREE.Color(settings.particleColor) },
        uColorAccent: { value: new THREE.Color(settings.particleAccentColor) },
        uColorHighlight: { value: new THREE.Color(settings.particleHighlightColor) },
        uMouse: { value: new THREE.Vector2(20, 20) }
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    shaderMaterial.toneMapped = false;
    return shaderMaterial;
  }, []);

  const geometry = useMemo(() => {
    const nextGeometry = new THREE.BufferGeometry();
    const targetB = buffersB
      ? alignTargetPositions(buffers.positions, buffersB.positions)
      : buffers.positions;
    nextGeometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
    nextGeometry.setAttribute("aTargetB", new THREE.BufferAttribute(targetB, 3));
    nextGeometry.setAttribute("aOrigin", new THREE.BufferAttribute(buffers.origins, 3));
    nextGeometry.setAttribute("aSeed", new THREE.BufferAttribute(buffers.seeds, 1));
    nextGeometry.setAttribute("aSize", new THREE.BufferAttribute(buffers.sizes, 1));
    nextGeometry.setAttribute("aDelay", new THREE.BufferAttribute(buffers.delays, 1));
    nextGeometry.setAttribute(
      "aIntensity",
      new THREE.BufferAttribute(buffers.intensities, 1)
    );
    nextGeometry.computeBoundingSphere();
    return nextGeometry;
  }, [buffers, buffersB]);

  useEffect(() => {
    const nextBlending =
      settings.logoStyle === "clouds" ? THREE.NormalBlending : THREE.AdditiveBlending;

    if (material.blending !== nextBlending) {
      material.blending = nextBlending;
      material.needsUpdate = true;
    }
  }, [material, settings.logoStyle]);

  useEffect(() => {
    resetOnNextFrame.current = true;
  }, [replayNonce]);

  useEffect(() => {
    const canvas = gl.domElement;
    const activateMouse = () => {
      lastPointerAt.current = performance.now() / 1000;
    };
    const deactivateMouse = () => {
      mouseField.current = 0;
    };

    canvas.addEventListener("pointermove", activateMouse);
    canvas.addEventListener("pointerdown", activateMouse);
    canvas.addEventListener("pointerleave", deactivateMouse);
    window.addEventListener("blur", deactivateMouse);

    return () => {
      canvas.removeEventListener("pointermove", activateMouse);
      canvas.removeEventListener("pointerdown", activateMouse);
      canvas.removeEventListener("pointerleave", deactivateMouse);
      window.removeEventListener("blur", deactivateMouse);
    };
  }, [gl]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((state, delta) => {
    if (paused) {
      return;
    }

    runningTime.current += delta;

    if (resetOnNextFrame.current) {
      startTime.current = runningTime.current;
      resetOnNextFrame.current = false;
    }

    const elapsed = runningTime.current - startTime.current;
    const progress = Math.min(1, elapsed * 0.5 * settings.animationSpeed);
    const birthPulse = Math.sin(progress * Math.PI) * (1 - progress * 0.16);
    const viewport = state.viewport;
    targetMouse.current.set(
      state.pointer.x * viewport.width * 0.5,
      state.pointer.y * viewport.height * 0.5
    );
    const mouseLerp = 1 - Math.exp(-delta * 9.5);
    smoothedMouse.current.lerp(targetMouse.current, mouseLerp);

    const secondsSincePointer = performance.now() / 1000 - lastPointerAt.current;
    const targetField = Math.exp(-Math.max(0, secondsSincePointer - 0.12) * 2.4);
    const fieldLerp = 1 - Math.exp(-delta * 5.2);
    mouseField.current += (targetField - mouseField.current) * fieldLerp;

    material.uniforms.uTime.value = runningTime.current;
    material.uniforms.uProgress.value = progress;
    material.uniforms.uPointSize.value = settings.pointSize;
    material.uniforms.uScatter.value = settings.scatterRadius;
    material.uniforms.uTurbulence.value = settings.turbulence;
    material.uniforms.uMouseForce.value = settings.mouseForce;
    material.uniforms.uMouseActive.value = mouseField.current;
    material.uniforms.uAttractRadius.value = settings.attractRadius;
    material.uniforms.uRepelRadius.value = settings.repelRadius;
    material.uniforms.uFlicker.value = settings.flicker;
    material.uniforms.uBreathe.value = settings.breathe;
    material.uniforms.uBirthPulse.value = Math.max(0, birthPulse);
    material.uniforms.uDpr.value = Math.min(2, state.gl.getPixelRatio());
    material.uniforms.uStyle.value = getStyleIndex(settings.logoStyle);
    material.uniforms.uMotionSpeed.value = settings.animationSpeed;
    material.uniforms.uMorph.value = morphBlend;
    material.uniforms.uColorPrimary.value.set(settings.particleColor);
    material.uniforms.uColorAccent.value.set(settings.particleAccentColor);
    material.uniforms.uColorHighlight.value.set(settings.particleHighlightColor);
    material.uniforms.uMouse.value.copy(smoothedMouse.current);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
