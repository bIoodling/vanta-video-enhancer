import {
  defaults,
  dimensions,
  readSettings,
  type Settings,
  type Status,
} from "./state";
import { scoreVideo, videos } from "./discovery";
import { createBackend, type Backend } from "./gpu";
let settings: Settings = defaults,
  selected: HTMLVideoElement | null = null,
  active = false,
  generation = 0;
let backend: Backend | null = null,
  canvas: HTMLCanvasElement | null = null,
  callback = 0,
  raf = 0,
  busy = false;
let status: Status = { state: "Disabled", detail: "Enhancement is off" },
  factor = 1,
  slow = 0,
  frames = 0,
  lastMedia = -1;
let errorVideo: HTMLVideoElement | null = null,
  errorKey = "";
let alive = true,
  recoveries = 0,
  fpsBase = 0,
  fpsMedia = 0,
  measuredFps: number | undefined;
const interactions = new WeakMap<HTMLVideoElement, number>();
const site = location.hostname;
const send = (m: unknown) => chrome.runtime.sendMessage(m).catch(() => {});
function stop() {
  generation++;
  if (selected && callback) selected.cancelVideoFrameCallback?.(callback);
  cancelAnimationFrame(raf);
  callback = 0;
  raf = 0;
  canvas?.remove();
  canvas = null;
  backend?.dispose();
  backend = null;
  busy = false;
}
function blocked(v: HTMLVideoElement) {
  if (v.mediaKeys) return "Protected media cannot be processed";
  if (document.pictureInPictureElement === v)
    return "Picture-in-picture uses the original video";
  if (document.fullscreenElement === v)
    return "Native video fullscreen uses the original video";
  if (v.textTracks && [...v.textTracks].some((t) => t.mode === "showing"))
    return "Native captions use the original video";
  return "";
}
function position() {
  if (!canvas || !selected) return;
  const v = selected,
    r = v.getBoundingClientRect(),
    s = getComputedStyle(v);
  const nativeHover = v.controls && v.matches(":hover, :focus");
  canvas.style.visibility =
    nativeHover || document.hidden ? "hidden" : "visible";
  // Fixed positioning tracks the player without changing its DOM or styles.
  const ratio = v.videoWidth / v.videoHeight;
  let w = r.width,
    h = r.height,
    x = r.left,
    y = r.top;
  const cover = s.objectFit === "cover";
  if (["contain", "scale-down", "cover", ""].includes(s.objectFit)) {
    if (w / h > ratio !== cover) {
      w = h * ratio;
    } else {
      h = w / ratio;
    }
    if (s.objectFit === "scale-down" && w > v.videoWidth) {
      w = v.videoWidth;
      h = v.videoHeight;
    }
    const coordinates = s.objectPosition.split(" ");
    if (coordinates.length !== 2 || coordinates.some((c) => !c.endsWith("%")))
      throw Error("Unsupported video object position");
    x += ((r.width - w) * parseFloat(coordinates[0])) / 100;
    y += ((r.height - h) * parseFloat(coordinates[1])) / 100;
  }
  const transform = new DOMMatrixReadOnly(
    s.transform === "none" ? undefined : s.transform,
  );
  if (
    !transform.is2D ||
    Math.abs(transform.b) > 0.0001 ||
    Math.abs(transform.c) > 0.0001 ||
    transform.a <= 0 ||
    transform.d <= 0 ||
    !["contain", "cover", "scale-down", "fill", ""].includes(s.objectFit)
  )
    throw Error("Unsupported player transform or crop");
  for (let parent = v.parentElement; parent; parent = parent.parentElement) {
    const ps = getComputedStyle(parent);
    if (
      ps.transform !== "none" ||
      ps.perspective !== "none" ||
      ps.filter !== "none"
    )
      throw Error("Unsupported transformed player container");
  }
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
    pointerEvents: "none",
    zIndex: s.zIndex === "auto" ? "auto" : s.zIndex,
    borderRadius: s.borderRadius,
    margin: "0",
    padding: "0",
    clipPath: cover
      ? `inset(${Math.max(0, r.top - y)}px ${Math.max(0, x + w - r.right)}px ${Math.max(0, y + h - r.bottom)}px ${Math.max(0, r.left - x)}px)`
      : "none",
  });
  // Sibling stacking preserves site captions and controls placed after the video.
  if (canvas.previousSibling !== v) v.after(canvas);
}
async function begin(v: HTMLVideoElement) {
  stop();
  const token = generation;
  status = { state: "Starting", detail: "Initialising GPU" };
  let result: Awaited<ReturnType<typeof createBackend>> | null = null;
  try {
    result = await createBackend(document.createElement("canvas"));
    if (token !== generation) {
      result.backend.dispose();
      return;
    }
    backend = result.backend;
    canvas = result.canvas;
    canvas.dataset.vanta = "output";
    canvas.setAttribute("aria-hidden", "true");
    factor = 1;
    frames = 0;
    fpsBase = 0;
    fpsMedia = 0;
    measuredFps = undefined;
    lastMedia = -1;
    position();
    schedule(token);
  } catch (e) {
    if (token === generation) fail(e, v);
  }
}
function fail(e: unknown, v: HTMLVideoElement) {
  stop();
  errorVideo = v;
  errorKey = v.currentSrc;
  const detail = e instanceof Error ? e.message : String(e);
  if (/device lost|context lost/i.test(detail) && recoveries++ < 1) {
    errorVideo = null;
  }
  status = {
    state: /security|cross.origin|taint|protected|unsupported/i.test(detail)
      ? "Unsupported"
      : /unavailable/i.test(detail)
        ? "GPU unavailable"
        : "Processing error",
    detail,
  };
}
function schedule(token: number) {
  if (token !== generation || !selected) return;
  if (selected.requestVideoFrameCallback)
    callback = selected.requestVideoFrameCallback((_, metadata) => {
      frames = metadata.presentedFrames;
      if (metadata.mediaTime < fpsMedia || !fpsBase) {
        fpsBase = frames;
        fpsMedia = metadata.mediaTime;
      } else if (metadata.mediaTime - fpsMedia >= 1) {
        measuredFps = Math.round(
          (frames - fpsBase) / (metadata.mediaTime - fpsMedia),
        );
        fpsBase = frames;
        fpsMedia = metadata.mediaTime;
      }
      void frame(token, metadata.mediaTime);
    });
  else
    raf = requestAnimationFrame(() => void frame(token, selected!.currentTime));
}
async function frame(token: number, mediaTime: number) {
  const v = selected;
  if (token !== generation || !v || !canvas || !backend) return;
  if (busy) {
    schedule(token);
    return;
  }
  if (
    document.hidden ||
    scoreVideo(v) < 0 ||
    v.readyState < 2 ||
    mediaTime === lastMedia
  ) {
    schedule(token);
    return;
  }
  const reason = blocked(v);
  if (reason) {
    stop();
    status = { state: "Unsupported", detail: reason };
    return;
  }
  busy = true;
  try {
    position();
    const output = dimensions(
      v.videoWidth,
      v.videoHeight,
      settings.scale,
      backend.limit,
      factor,
    );
    if (canvas.width !== output[0] || canvas.height !== output[1]) {
      canvas.width = output[0];
      canvas.height = output[1];
    }
    const started = performance.now();
    await backend.render(v, settings.quality);
    if (token !== generation) return;
    const elapsed = performance.now() - started;
    lastMedia = mediaTime;
    const budget = 1000 / Math.max(24, status.fps || 30);
    slow = elapsed > budget * 0.85 ? slow + 1 : Math.max(0, slow - 1);
    if (slow >= 8 && factor > 0.38) {
      factor *= 0.8;
      slow = 0;
    }
    status = {
      state: "Enhancing",
      detail:
        factor < 1
          ? "Adaptive resolution active"
          : `${backend.name} · ${settings.quality}`,
      width: v.videoWidth,
      height: v.videoHeight,
      output,
      backend: backend.name,
      processingMs: elapsed,
      gpuMs: backend.gpuMs,
      dropped: v.getVideoPlaybackQuality?.().droppedVideoFrames,
      memoryBytes:
        (v.videoWidth * v.videoHeight * 2 +
          output[0] * output[1] * (backend.name === "WebGPU" ? 2 : 1)) *
        4,
      fps: measuredFps,
    };
  } catch (e) {
    if (token === generation) fail(e, v);
    return;
  } finally {
    if (token === generation) busy = false;
  }
  schedule(token);
}
let scanning = false;
async function scan() {
  if (scanning || !alive) return;
  scanning = true;
  try {
    const candidates = videos()
      .map((v) => ({ v, score: scoreVideo(v, interactions.get(v)) }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const next = best?.v ?? null;
    if (next !== selected) {
      stop();
      selected = next;
      errorVideo = null;
      errorKey = "";
      recoveries = 0;
    }
    if (errorVideo === selected && selected?.currentSrc !== errorKey)
      errorVideo = null;
    if (!settings.enabled) {
      if (backend) stop();
      status = { state: "Disabled", detail: "Enhancement is off" };
    } else if (!selected) {
      if (backend) stop();
      status = {
        state: "No video detected",
        detail: "Play a video on this page",
      };
    } else if (!active) {
      if (backend) stop();
      status = {
        state: "Video detected",
        detail: "Another frame has the active player",
      };
    } else if (document.hidden) {
      if (canvas) canvas.style.visibility = "hidden";
    } else if (blocked(selected)) {
      if (backend) stop();
      status = { state: "Unsupported", detail: blocked(selected) };
    } else if (!backend && errorVideo !== selected) await begin(selected);
    if (canvas)
      try {
        position();
      } catch (e) {
        fail(e, selected!);
      }
    await send({
      type: "report",
      status: {
        ...status,
        width: selected?.videoWidth,
        height: selected?.videoHeight,
        score: best?.score ?? -1,
      },
    });
  } finally {
    scanning = false;
  }
}
function interaction(e: Event) {
  const path = e.composedPath();
  const v = path.find((el) => el instanceof HTMLVideoElement) as
    HTMLVideoElement | undefined;
  if (v && e.type === "pointerdown") interactions.set(v, Date.now());
  void scan();
}
let debounce = 0;
const observer = new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = window.setTimeout(() => void scan(), 100);
});
observer.observe(document, { childList: true, subtree: true });
for (const event of [
  "play",
  "pause",
  "loadedmetadata",
  "emptied",
  "pointerdown",
  "seeking",
  "fullscreenchange",
  "enterpictureinpicture",
  "leavepictureinpicture",
])
  document.addEventListener(event, interaction, true);
let timer = setInterval(() => void scan(), 1000);
chrome.runtime.onMessage.addListener((m, _sender, respond) => {
  if (m.type === "frameStatus") {
    respond(status);
    return;
  }
  if (m.type === "select" && active !== m.active) {
    active = m.active;
    void scan();
  }
});
chrome.storage.onChanged.addListener(() => {
  void readSettings(site).then((s) => {
    if (s.quality !== settings.quality || s.scale !== settings.scale) {
      factor = 1;
      slow = 0;
      lastMedia = -1;
    }
    settings = s;
    errorVideo = null;
    void scan();
  });
});
void readSettings(site).then((s) => {
  settings = s;
  void scan();
});
window.addEventListener("pagehide", () => {
  alive = false;
  stop();
  observer.disconnect();
  clearInterval(timer);
  clearTimeout(debounce);
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    alive = true;
    observer.observe(document, { childList: true, subtree: true });
    timer = setInterval(() => void scan(), 1000);
    void scan();
  }
});
