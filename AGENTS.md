# particle-svg-logo Agent Guide

Instructions for every coding agent working in this repository. Keep this file current; add new findings here.

## Project

- Siyu's own creative-coding tool (also called Walkers / SVG Shader Lab). Upload, paste or draw an SVG and get an interactive WebGL logo: particles, ASCII, metal, glitch, SDF bubbles, webcam-driven walking crowds, a two-logo morph timeline and canvas video export. Pitch: it lowers real-time visual creation from "writing shaders" to "having an SVG".
- Live: https://logo.whothree.com (default style Walkers at `/`; every style has its own path such as `/sdf` or `/ascii`). Also `particle-svg-logo.vercel.app`. `logo.whothree.space` is dead because the domain expired around 2026-10-31; old social copy still links to it.
- Deploy: Vercel Git integration on `siyuhuh/particle-svg-logo`. A push to `main` creates a production deployment. `vercel.json` rewrites every path to `index.html` for the per-style URLs.
- Stack: Vite 8 + React 19 + TypeScript 6, three 0.182, `@react-three/fiber` 9, drei 10, postprocessing, `@mediapipe/tasks-vision` with the hand model and wasm served locally from `public/mediapipe/` (no CDN).
- History: started 2026-05-20 in Codex under `~/Documents/particle-svg-logo`, first pushed to a private `gottaegbert/particle-svg-logo` repo, then moved to `~/Downloads/project/particle-svg-logo` and `siyuhuh` (2026-09-06). Pushes go to `siyuhuh`. Claude Remote Control on the mini serves this checkout.
- Map: `src/effectsCatalog.ts` (style list, production vs dev, URL slugs), `src/App.tsx` (UI, presets, per-style settings, routing), `src/ParticleLogoScene.tsx` (shader and scene branches), `src/WebcamWalkersOverlay.tsx`, `src/useHandTracking.ts` / `handGestures.ts` / `HandPointerControl.tsx`, `src/svgSampler.ts` / `svgSanitize.ts` / `sceneSizing.ts`, `src/logoMorph.ts` + `MorphTimelineBar.tsx`, `src/videoCapture.ts`, `src/defaultLogo.ts` (default WHOTHREE SVG).

## Commands

- `npm run dev` serves Vite on `127.0.0.1:5173`. Webcam access works there; testing the camera from another device on the LAN needs HTTPS.
- `npm run typecheck` (`tsc --noEmit`) is the normal check. Siyu prefers no `npm run build` during iteration.
- Deploy: commit and push `main`, then confirm the Vercel deployment is READY and the live URL returns 200. No manual `vercel` CLI step is needed (the CLI is not installed on the mini).

## Decisions

- 2026-05-20: Black-and-white UI, transparent scrollbars, ruler-like debug UI, a Figma-style full-screen drawing canvas with a pen tool for Bezier curves. Drawing animates a natural stroke instead of updating instantly. Each effect keeps its own parameter set. Settings can be copied as JSON. Upload applies automatically; the particle count scales with SVG size; flow noise defaults to 0.2.
- 2026-06-03: Dark SVGs on a dark UI: the sidebar preview uses a neutral light checkerboard. Do not invert the SVG or use blend modes; the sampler only reads shape.
- 2026-06-10: Walkers added as a style inside the logo app, not as a separate project. MediaPipe hand tracking, not p5.js (the social-copy draft got this wrong).
- 2026-06-11: Every style has a shareable URL; a refresh keeps the current style.
- 2026-06-22: Unfinished effects are dev-only. `PRODUCTION_LOGO_STYLE_IDS` lists shipped styles; the others show only when `import.meta.env.DEV` is true, at the end of the list with a DEV tag. To promote an effect, move its id into that array. A production slug that names a dev style falls back to the default.
- 2026-06-22: Mobile: a bottom dock and sheet keep the canvas full-screen; the effect picker uses compact, brick-like chips.
- 2026-07-04 and 2026-09-06: SDF metaball bubbles fill the SVG as a container with collision. Drift and Aquarium-rise modes; rising bubbles shrink like soda bubbles, with noise and a per-bubble period; no fixed bubbles. 2026-09-06 defaults: Cloud drift, white fill, dark outline, grid off. SDF moved from dev to production and gained the Walkers-style camera interaction.
- 2026-09-11: Walkers became the homepage. Added canvas video export and a draggable morph timeline between logos with editable transition times; logos stay fully formed during each hold.
- 2026-10-15: Security advisories were fixed within existing major versions (PR #1). Keep dependency fixes inside current majors unless Siyu asks.

## Pitfalls

- Hand-drawn SVG paths that were not closed broke fill sampling (2026-06-09). Keep drawn paths closed.
- Canvas cropping differed between styles; sizing must be uniform (`sceneSizing.ts`).
- Mouse interaction once blurred line effects. Hover should change speed, not distort the strokes.
- SDF morph left an uncleared canvas (2026-09-11). Clear between logos, and do not switch logos before the current one has formed.
- SDF fill gaps came from a bubble cap that was too low, ring-offset spawning, weak metaball blending and strong collision separation. Spawn from fill samples and allow overlap.
- `.tmp-video-frames/` (video export scratch) is untracked, and `output/` is ignored. Never commit either.
- 2026-11-07: the main checkout has uncommitted SDF cloud work (`src/sdfCloudLayout.ts`, `src/sdfCloudRenderer.ts`, edits in `App.tsx`, `ParticleLogoScene.tsx`, `styles.css`, `types.ts`, from 2026-10-27/28). Do not touch or stash it; use a worktree for unrelated changes. When committing, stage only the files for the task.

## Acceptance / verification

- Siyu reviews in the in-app browser at `127.0.0.1:5173` (often with a `?fresh=` cache-busting query), with screenshots and screen recordings compared against a reference (CodePen, Codrops, GitHub demos, brik.space frame-flow, TouchDesigner clips).
- Webcam gestures are tested with a real camera and hand: the crowd clears, piles up and walks back.
- Check the mobile layout so the UI does not cover the interactive canvas.
- After a push, confirm the Vercel deployment and HTTP 200 on the live URL.

## Siyu's preferences for this project

- Effects must look premium ("效果一点要酷炫"). Match the reference closely; if that is not possible, say why ("尽量都一模一样 如果不行 给出原因"). No outline on shaders by default. Metal means real extruded 3D through R3F.
- Walkers should move like pedestrians or ants being pushed: cleared under the hand, piled at the edges, accelerating walk back with adjustable return speed and wander, foot-locked gait with no sliding, correct front/back occlusion, outlined heads, gender variants, editable colors. Knockdowns were judged unnecessary ("推倒机制效果一般 感觉不需要").
- Motion feels natural and a little random (Perlin or flow noise), with a magnetic-field-like return rather than a poke.
- Keep the UI compact and refined; oversized buttons and text get rejected.
- Social copy (X and 小红书) and the Screen Studio voice-over live in mainlife: `01-Projects/Active/particle-walkers-social-copy-2026-06-11.md` and `particle-svg-logo-screen-studio-voiceover-2026-06-20.md`. Name the product and link it when writing copy.
