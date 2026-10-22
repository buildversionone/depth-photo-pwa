# Depth Photo

An offline-first, Android-first PWA that turns a single photo into a subtle 3D window: the subject stays fixed on screen while the background shifts gently as you tilt the phone.

Everything runs on the device. Photos are never uploaded.

**Status:** Milestone 1 (renderer and motion, using a built-in sample scene). Segmentation of your own photos arrives in Milestone 2. See the [technical assessment](https://claude.ai/artifact/1KTjAiMzBcMwTEsgnvyKLF) and [docs/milestones.md](docs/milestones.md).

## Try it

The latest `main` is deployed to GitHub Pages: https://buildversionone.github.io/depth-photo-pwa/

On Android Chrome, use the menu → **Add to Home screen** to install it. After the first visit it works offline.

## Develop

Requires Node 22.

```sh
npm ci
npm run dev          # dev server (use --host URL on a phone on the same network; sensors need HTTPS)
npm test             # unit tests (Vitest)
npm run build        # typecheck + production build
npm run test:e2e     # browser tests (Playwright; builds must exist: run `npx vite build` first)
```

In cloud containers with a preinstalled Chromium, set `CHROMIUM_PATH=/opt/pw-browsers/chromium` for Playwright.

## Layout

```
src/
  main.ts       app wiring: renderer, sensors, controls, service worker
  app/          settings, styles
  motion/       tilt sources, One Euro filter, spring, motion controller
  render/       WebGL2 compositor, Canvas 2D fallback, layout maths
  scene/        procedural sample scene (until segmentation exists)
  shared/       shared types
tests/unit      Vitest
tests/e2e       Playwright
```

## How the effect works

Two pixel-aligned layers: an opaque background and the subject with alpha. The shader samples the foreground at fixed coordinates and only the background at a shifted position, so the subject cannot drift. Both layers are cropped by the maximum shift on every edge, so the background never reveals empty space and nothing is scaled.

Tilt comes from `deviceorientation` when the phone has a gyroscope and from the gravity vector in `devicemotion` otherwise (the Galaxy A07 does not list a gyroscope). Readings pass through a One Euro filter, a slow re-centring of the neutral pose, a `tanh` soft limit, a critically damped spring and a hard clamp.
