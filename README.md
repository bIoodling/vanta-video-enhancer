# Vanta

Vanta is a Manifest V3 Chromium extension with local WebGPU video processing, a WebGL2 fallback, and a React popup based on the supplied design. This is a **private-test release**, not a claim of universal compatibility or Chrome Web Store readiness.

## Install the compiled extension

1. Extract `vanta-extension.zip`, or use the delivered `vanta-extension` folder.
2. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Reload an existing video tab, start playback, and open Vanta using its toolbar icon.
4. Turn on **Enhance Video**. Start with Balanced and Auto. Expand the detection panel to check the actual output resolution and compatibility reason.

There is no development server or account needed to run the built extension. The compact indicator lives inside the toolbar popup. There are no floating video controls.

## Build and test

Use Node.js 22 or newer with npm:

```sh
npm ci
npm run build
npx playwright install chromium
npm test
```

`dist/manifest.json` is the unpacked extension entry point. `npm test` launches an isolated headless Chromium profile and a local fixture server. It does not drive your existing browser or desktop. Tests record actual source and processed pixels, popup screenshots, and raw timing samples in `test-results/`. The generated fixture uses locally recorded VP8 WebM files with landscape and portrait content; it never downloads a streaming site's media.

## What the GPU actually does

Both backends use two GPU render passes. The source-sized pass applies a spatial bilateral filter that rejects samples across strong colour edges. The output-sized pass reconstructs the image and applies bounded edge enhancement with neighbourhood clamping to reduce ringing. This is spatial signal processing; there is no neural model or claim of newly recovered native-resolution detail.

| Preset | Cleanup neighbourhood | Reconstruction | Edge processing |
|---|---|---|---|
| Balanced | 3 × 3 bilateral | Hardware linear sampling | Moderate clamped enhancement |
| High | 5 × 5 bilateral | 16-tap cubic | Stronger cleanup and bounded enhancement |
| Ultra | 7 × 7 bilateral | 36-tap Lanczos-3 | Directional edge preservation and clamping |

The smoothing can reduce modest compression noise and some gradient banding, but there is no dedicated temporal denoiser, motion compensation, or specialised deblocking/debanding model. Strong compression damage will remain. Ultra is intentionally more expensive and requires confirmation.

Targets preserve the encoded source aspect ratio. A 16:9 4K target is 3840 × 2160; a 9:16 target is 2160 × 3840. Auto targets up to 1.5× the source's longest dimension, capped at 2560. Output is bounded by device texture limits and 8,294,400 pixels. Sustained slow completion reduces output dimensions and reports the actual dimensions rather than relabelling reduced output as 4K.

## Architecture

- `src/popup.tsx`, `popup.css`: main view, Ultra dialog, compact view and local site preferences.
- `src/background.ts`: tab/frame election and status routing. Reports expire after four seconds.
- `src/discovery.ts`: real HTMLVideoElement discovery, including accessible open shadow roots; scoring uses visible area, playback, mute/volume and recent pointer interaction.
- `src/content.ts`: DOM observation, frame scheduling, surface compositing, performance adaptation and cleanup. One selected player per tab is processed.
- `src/gpu.ts`, `shaders.ts`: bounded textures, shaders, WebGPU timestamp queries where available, WebGL2 fences and resource disposal.
- `tests/`: browser integration, synthetic media fixture, cross-origin frame election, compatibility failures and captured measurements.

## Permissions and privacy

`storage` persists settings locally. HTTP/HTTPS content-script match patterns are necessary to detect videos and process permitted frames across arbitrary websites and permitted child frames. There is no `tabs`, `scripting`, downloads, network interception, microphone or camera permission. Browser-protected pages cannot run the extension. No media URLs are changed or downloaded, and no network requests, telemetry, remote executable code, models or accounts are used at runtime.

See [COMPATIBILITY.md](COMPATIBILITY.md) for playback restrictions and [VALIDATION.md](VALIDATION.md) for measured results and gaps. All rights reserved; no open-source licence is granted.
