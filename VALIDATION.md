# Validation — 18 November 2026

## Automated checks

The production TypeScript build passed. Ten Playwright integration tests passed in 30.6 seconds with the compiled Manifest V3 extension installed in a separate, headless Chromium 159.0.8154.6 profile on Windows. The test launcher enables experimental/unsafe WebGPU availability for that isolated profile; it does not change the user's normal browser flags. Retail Chrome driver restrictions may differ.

Covered: popup width and overflow; Ultra cancel/confirm and saved warning preference; settings persistence; compact view; real-video discovery versus static images/GIFs; hidden ad rejection; dynamic player selection/removal; actual WebGPU and WebGL2 pixel output for three presets; capability fallback; GPU-unavailable handling; WebGL disposal; portrait output; playback speed and seeking; native-caption fallback and recovery; native-control reveal; same-origin/cross-origin iframe election; cross-origin media security failure; output dimension limits; and requested 1080p/4K rendering.

The actual adapter identified itself as NVIDIA / Lovelace and `isFallbackAdapter: false`. Exact board and driver identifiers were not exposed. This is **one dedicated GPU**, not an integrated-GPU compatibility study.

## Measured playback sample

For a locally recorded **320 × 180 VP8 clip**, Ultra processed an actual **3840 × 2160** output over a five-second observation. The decoder's cumulative frame count increased from 9 to 126; its dropped-frame count stayed at zero. Playback remained active at speed 1.0. The final status sample recorded 9.6 ms submission-to-completion, 8.32 ms from GPU pass timestamp queries, and 66,816,000 bytes of estimated explicit texture/canvas storage.

This is not a 1080p-to-4K benchmark. The cleanup pass works at source size, so larger encoded sources increase cost substantially. Browser compositing, decode surfaces, driver allocations, front/back buffering and process memory are not included in the texture estimate. Decoder dropped frames do not count every missed enhancement update or establish audiovisual synchronization.

`evidence/benchmark.json` contains six raw completion samples per preset/backend for 320 × 180 → 480 × 270. Completion samples include upload, command submission, GPU completion signalling and JavaScript scheduling. They are not pure shader execution times. WebGPU `gpuMs` uses optional timestamp queries and excludes uploads/presentation. Timing readback is asynchronous; a reported GPU sample can describe the preceding render. WebGL2 GPU timestamp timing is not implemented; only completion timing is recorded there. No invented memory, frame-rate or timing numbers are used.

`evidence/stability.json` records the raw playback observation and final engine status. This short run does not establish long-duration stability, thermal behaviour, battery use, memory-leak absence or performance on ordinary laptops.

## Visual review

The main popup, warning and compact screenshots were rendered from functional controls and visually inspected against the supplied reference. The main view is 410 pixels wide and approximately 483 pixels high, fitting Chromium popup constraints. Its proportions, dark surfaces, purple selection borders, icon shapes and control placement were adjusted toward the reference. Exact pixel equivalence is not claimed; the UI uses the locally available Segoe UI/Arial stack and real detected states rather than fabricated source statistics. Automated checks verify width and absence of horizontal overflow. No screenshot is used as the interactive interface.

`evidence/captures/source.png` is a real decoded source frame at the comparison size. The `WebGPU-*.png` and `WebGL2-*.png` files are actual shader output from that same paused frame, read back from the processing surface. They have not been artistically retouched. The synthetic pattern is intentionally small and compressed; differences are modest and cannot be used as evidence of reconstructed native detail.

## Remaining acceptance gaps

No public-release certification is made. Long-form live streams, audio/video synchronization measurement, integrated GPUs, HDR, device-loss injection, arbitrary custom fullscreen layouts, closed shadow players and broad site regression coverage remain unverified. The automated suite tests native-caption fallback. Native PiP and fullscreen transitions still need manual validation; enhanced native PiP and native-video fullscreen are not supported.

Real-site probes are recorded separately in `evidence/site-probes.json` and `evidence/site-integration.json`. A momentary successful detection/render sample cannot establish site-wide compatibility. YouTube Shorts encountered a consent interstitial in the initial probe. No accounts were signed in and no consent preferences were changed.

After cover-crop handling was added, a fresh isolated YouTube watch-page check processed a real 854 × 480 video through WebGPU Balanced at an actual 1281 × 720 output. Its final completion sample was 71.6 ms, with zero reported decoder drops at that instant. That slow completion sample is a performance concern, not evidence of smooth playback. The short probe did not establish sustained throughput or adaptive-resolution convergence. TikTok returned a login/feed layout where the extension reported no selected video, so functional TikTok enhancement remains unverified.

## Reproduce on another device

1. Build and run the suite using the README commands. Keep raw `benchmark.json`, `stability.json` and screenshots.
2. Record Chrome version, OS, adapter/driver and whether hardware acceleration is enabled. Repeat with the test WebGPU flag removed to check the retail-driver path.
3. Use licensed local or CORS-approved clips with actual 480p, 720p, 1080p and 4K sources; include portrait footage, gradients, fine outlines, textured motion and compression noise.
4. For each quality/target, run for at least ten minutes. Compare actual canvas output dimensions, GPU timestamp results where available, decoder dropped-frame deltas, enhanced update cadence, browser task-manager memory and power behaviour. A measured decoder rate is not an enhancement throughput counter.
5. Check audio sync with an audiovisual sync test clip; verify pause, seek, captions, native/site controls, resize, container fullscreen, PiP fallback, SPA replacement, tab hiding and restoring. Trigger GPU context/device loss in an instrumented development build and inspect resource recovery.
6. Compare lossless source/processed readbacks from identical paused frames. Evaluate halos, line preservation, texture loss, banding and temporal stability; prefer Balanced when stronger processing provides no useful improvement.

