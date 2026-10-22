# Milestones

| | Goal | Status |
|---|---|---|
| M0 | Scaffold: Vite + TypeScript, PWA manifest and service worker, tests, CI, Pages deploy | Done |
| M1 | Renderer and motion with a sample scene; sensor pipeline, drag fallback, reduced motion, iOS permission, debug readout | Built and tested in desktop Chromium; **needs testing on the Galaxy A07** |
| M2 | Segmentation (MediaPipe DeepLab-v3 + MagicTouch), tap-to-select fallback | Not started |
| M3 | Edge refinement, background band fill, blur, automatic motion range | Not started |
| M4 | Offline model setup, storage persistence, error handling, export | Not started |
| M5 | Cross-browser pass (Samsung Internet, Chrome, iOS Safari) | Not started |

## M1 on-device checklist (Galaxy A07)

Open the Pages URL in Chrome, open **Settings → Show debug readout**, then check:

- [ ] `sensor` line shows `orientation` or `gravity` with a rate above ~30 Hz. If it says `off` or 0 Hz, tilt does not work on this phone.
- [ ] Gentle tilting moves the mountains; the hiker and rock stay still.
- [ ] Motion feels smooth, not jittery, and does not lag noticeably.
- [ ] Direction feels natural. If not, try **Invert horizontal / vertical** and report which feels right.
- [ ] Hard tilting never shows an empty edge.
- [ ] After install to the home screen, the app opens in airplane mode.
