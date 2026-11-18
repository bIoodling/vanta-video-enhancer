import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
let context: BrowserContext, worker: Worker, id: string;
test.beforeAll(async () => {
  const extension = resolve("dist");
  context = await chromium.launchPersistentContext(
    resolve("test-results/profile"),
    {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--autoplay-policy=no-user-gesture-required",
        "--enable-unsafe-webgpu",
      ],
      viewport: { width: 1100, height: 850 },
    },
  );
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  id = worker.url().split("/")[2];
  await mkdir("test-results/captures", { recursive: true });
});
test.afterAll(async () => {
  await context?.close();
});
async function settings(value: any) {
  await worker.evaluate(async (s) => {
    await chrome.storage.local.set({
      settings: {
        enabled: false,
        quality: "balanced",
        scale: "auto",
        skipUltra: false,
        compact: false,
        ...s,
      },
      sites: {},
    });
  }, value);
}
async function fixture() {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page.evaluate(() => (window as any).ready);
  return page;
}
test("installed MV3 extension; popup layout, Ultra cancellation, persistence and compact view", async () => {
  await settings({ enabled: true, scale: "2160" });
  const page = await context.newPage();
  await page.setViewportSize({ width: 410, height: 600 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await expect(
    page.getByRole("heading", { name: "Enhance Video" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("width", "410px");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= 410),
  ).toBeTruthy();
  await page
    .locator("main")
    .screenshot({ path: "test-results/captures/popup.png" });
  await page.getByRole("button", { name: "Ultra", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .locator("main")
    .screenshot({ path: "test-results/captures/ultra-warning.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Balanced", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Ultra", exact: true }).click();
  await page.getByLabel("Don’t show again").check();
  await page.getByRole("button", { name: "Enable Ultra", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Ultra", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Use compact view" }).click();
  await expect(
    page.getByRole("button", { name: "Expand Vanta" }),
  ).toBeVisible();
  await page
    .locator("main")
    .screenshot({ path: "test-results/captures/compact.png" });
  await page.close();
});
test("detection, dynamic selection, actual GPU processing, disable and disposal", async () => {
  await settings({ enabled: true });
  const page = await fixture();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator("canvas[data-vanta]")).toBeAttached({
    timeout: 15000,
  });
  await page.addScriptTag({ url: "/test-results/harness.js" });
  const found = await page.evaluate(() => {
    const h = (window as any).VantaTest;
    return {
      count: h.videos().length,
      main: h.scoreVideo(document.querySelector("#main")),
      ad: h.scoreVideo(document.querySelector("#advert")),
      portrait: h.scoreVideo(document.querySelector("#portrait")),
    };
  });
  expect(found.count).toBe(3);
  expect(found.main).toBeGreaterThan(found.portrait);
  expect(found.ad).toBe(-1);
  await page.screenshot({ path: "test-results/captures/integration.png" });
  await page.getByRole("button", { name: "Add video" }).click();
  await expect(page.locator("#added")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("#added").evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBe(320);
  await page.locator("#added").scrollIntoViewIfNeeded();
  await page.locator("#added").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector("canvas[data-vanta]")?.previousElementSibling
            ?.id,
      ),
    )
    .toBe("added");
  await page.locator("#added").evaluate((v) => v.remove());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector("canvas[data-vanta]")?.previousElementSibling
            ?.id,
      ),
    )
    .toBe("main");
  await settings({ enabled: false });
  await expect(page.locator("canvas[data-vanta]")).toHaveCount(0);
  const t = await page
    .locator("#main")
    .evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(200);
  expect(
    await page
      .locator("#main")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).not.toBe(t);
  expect(errors).toEqual([]);
  await page.close();
});
test("both backends execute reconstruction; real before/after captures and measured results", async () => {
  await settings({ enabled: false });
  const page = await fixture();
  await page.addScriptTag({ url: "/test-results/harness.js" });
  const results = await page.evaluate(async () => {
    const h = (window as any).VantaTest,
      v = document.querySelector<HTMLVideoElement>("#main")!;
    v.pause();
    const original = document.createElement("canvas");
    original.width = 480;
    original.height = 270;
    original.getContext("2d")!.drawImage(v, 0, 0, 480, 270);
    const records: any[] = [{ name: "source", png: original.toDataURL() }];
    for (const force of [false, true]) {
      const { backend, canvas, fallbackReason } = await h.createBackend(
        document.createElement("canvas"),
        force,
      );
      canvas.width = 480;
      canvas.height = 270;
      document.body.append(canvas);
      for (const q of ["balanced", "high", "ultra"]) {
        const times = [];
        for (let i = 0; i < 6; i++) {
          const t = performance.now();
          await backend.render(v, q);
          times.push(performance.now() - t);
        }
        const copy = document.createElement("canvas");
        copy.width = 480;
        copy.height = 270;
        if (backend.readPixels) {
          const pixels = await backend.readPixels();
          copy
            .getContext("2d")!
            .putImageData(new ImageData(pixels, 480, 270), 0, 0);
        } else copy.getContext("2d")!.drawImage(canvas, 0, 0);
        const data = copy.getContext("2d")!.getImageData(0, 0, 480, 270).data;
        let hash = 0,
          energy = 0;
        for (let i = 0; i < data.length; i += 4) {
          hash =
            (Math.imul(hash, 31) +
              data[i] +
              data[i + 1] * 3 +
              data[i + 2] * 7) |
            0;
          energy += data[i] + data[i + 1] + data[i + 2];
        }
        records.push({
          name: `${backend.name}-${q}`,
          hash,
          energy,
          fallbackReason,
          completionMs: times,
          gpuMs: backend.gpuMs,
          png: copy.toDataURL(),
          output: [canvas.width, canvas.height],
          estimatedTextureBytes:
            (320 * 180 * 2 + 480 * 270 * (backend.name === "WebGPU" ? 2 : 1)) *
            4,
        });
      }
      backend.dispose();
      canvas.remove();
    }
    return records;
  });
  for (const r of results) {
    await writeFile(
      `test-results/captures/${r.name}.png`,
      Buffer.from(r.png.split(",")[1], "base64"),
    );
    delete r.png;
  }
  await writeFile(
    "test-results/benchmark.json",
    JSON.stringify(results, null, 2),
  );
  const processed = results.filter((r) => r.hash !== undefined);
  expect(processed).toHaveLength(6);
  expect(
    processed.slice(0, 3).every((r) => r.name.startsWith("WebGPU-")),
  ).toBeTruthy();
  expect(
    processed.slice(3).every((r) => r.name.startsWith("WebGL2-")),
  ).toBeTruthy();
  expect(new Set(processed.map((r) => r.hash)).size).toBeGreaterThanOrEqual(3);
  expect(processed.every((r) => r.energy > 1000000)).toBeTruthy();
  await page.close();
});

test("capability fallback, GPU unavailable, and WebGL resource disposal", async () => {
  await settings({ enabled: false });
  const page = await fixture();
  await page.addScriptTag({ url: "/test-results/harness.js" });
  const result = await page.evaluate(async () => {
    const h = (window as any).VantaTest;
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    });
    const { backend, canvas, fallbackReason } = await h.createBackend(
      document.createElement("canvas"),
    );
    const name = backend.name;
    await backend.render(document.querySelector("#main"), "balanced");
    backend.dispose();
    const lost = canvas.getContext("webgl2")!.isContextLost();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => null) as any;
    let error = "";
    try {
      await h.createBackend(document.createElement("canvas"), true);
    } catch (e) {
      error = String(e);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
    return { name, lost, error, fallbackReason };
  });
  expect(result.name).toBe("WebGL2");
  expect(result.lost).toBeTruthy();
  expect(result.error).toContain("GPU unavailable");
  expect(result.fallbackReason).toContain("WebGPU unavailable");
  await page.close();
});

test("portrait rendering, playback speed, seeking, native captions and recovery", async () => {
  await settings({ enabled: true });
  const page = await fixture();
  await page.locator("#main").evaluate((v: HTMLVideoElement) => v.pause());
  await page.locator("#portrait").evaluate(async (v: HTMLVideoElement) => {
    v.playbackRate = 1.5;
    await v.play();
  });
  await page.locator("#portrait").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector("canvas[data-vanta]")?.previousElementSibling
            ?.id,
      ),
    )
    .toBe("portrait");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c =
          document.querySelector<HTMLCanvasElement>("canvas[data-vanta]");
        return c ? c.width < c.height : false;
      }),
    )
    .toBeTruthy();
  await page.locator("#portrait").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 0.4;
  });
  expect(
    await page
      .locator("#portrait")
      .evaluate((v: HTMLVideoElement) => v.playbackRate),
  ).toBe(1.5);
  await page.locator("#portrait").evaluate((v: HTMLVideoElement) => {
    const t = v.addTextTrack("captions", "Test", "en");
    t.mode = "showing";
  });
  await expect(page.locator("canvas[data-vanta]")).toHaveCount(0);
  await page.locator("#portrait").evaluate((v: HTMLVideoElement) => {
    v.textTracks[0].mode = "disabled";
  });
  await expect(page.locator("canvas[data-vanta]")).toBeAttached();
  await page.locator("#portrait").evaluate((v: HTMLVideoElement) => {
    v.controls = true;
    v.focus();
  });
  await page.locator("#portrait").hover();
  await expect(page.locator("canvas[data-vanta]")).toHaveCSS(
    "visibility",
    "hidden",
  );
  await page.close();
});

test("same-origin and cross-origin frames select one player per tab", async () => {
  await settings({ enabled: true });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/tests/frames.html");
  for (const f of page.frames().filter((f) => f !== page.mainFrame()))
    await f.evaluate(() => (window as any).ready);
  await expect
    .poll(
      async () => {
        let n = 0;
        for (const f of page.frames())
          n += await f.locator("canvas[data-vanta]").count();
        return n;
      },
      { timeout: 15000 },
    )
    .toBe(1);
  const cross = page
    .frames()
    .find((f) => f.url().startsWith("http://localhost:"))!;
  await cross.locator("#main").click();
  await expect(cross.locator("canvas[data-vanta]")).toBeAttached();
  await page.close();
});

test("cross-origin video fails safely and original playback continues", async () => {
  await settings({ enabled: true });
  const page = await fixture();
  const bytes = await page
    .locator("#main")
    .evaluate(async (v: HTMLVideoElement) =>
      Array.from(new Uint8Array(await (await fetch(v.src)).arrayBuffer())),
    );
  await page.route("http://localhost:4173/foreign.webm", (r) =>
    r.fulfill({
      status: 200,
      contentType: "video/webm",
      body: Buffer.from(bytes),
    }),
  );
  await page.locator("#main").evaluate(async (v: HTMLVideoElement) => {
    v.src = "http://localhost:4173/foreign.webm";
    await v.play();
  });
  await expect(page.locator("canvas[data-vanta]")).toHaveCount(0, {
    timeout: 10000,
  });
  expect(
    await page
      .locator("#main")
      .evaluate((v: HTMLVideoElement) => !v.paused && v.videoWidth === 320),
  ).toBeTruthy();
  await page.close();
});
test("aspect ratios, preset structure and invalid stored values", async () => {
  const page = await fixture();
  await page.addScriptTag({ url: "/test-results/harness.js" });
  const data = await page.evaluate(() => {
    const h = (window as any).VantaTest;
    return {
      landscape: h.dimensions(1920, 1080, "2160"),
      portrait: h.dimensions(1080, 1920, "2160"),
      limited: h.dimensions(1920, 1080, "2160", 2048),
      normalized: h.normalize({ quality: "bogus", scale: "x" }),
      radii: Object.values(h.presets).map((p: any) => p.radius),
    };
  });
  expect(data.landscape).toEqual([3840, 2160]);
  expect(data.portrait).toEqual([2160, 3840]);
  expect(Math.max(...data.limited)).toBeLessThanOrEqual(2048);
  expect(data.normalized.quality).toBe("balanced");
  expect(data.radii).toEqual([1, 2, 3]);
  await page.close();
});

test("requested resolution reaches real pipeline and records playback stability", async () => {
  await settings({ enabled: true, quality: "high", scale: "1080" });
  const page = await fixture();
  await expect
    .poll(
      () =>
        page
          .locator("canvas[data-vanta]")
          .evaluate((c: HTMLCanvasElement) => c.width),
      { timeout: 15000 },
    )
    .toBe(1920);
  await settings({ enabled: true, quality: "ultra", scale: "2160" });
  await expect
    .poll(() =>
      page
        .locator("canvas[data-vanta]")
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(3840);
  const before = await page
    .locator("#main")
    .evaluate((v: HTMLVideoElement) => ({
      ...v.getVideoPlaybackQuality().toJSON?.(),
      dropped: v.getVideoPlaybackQuality().droppedVideoFrames,
      total: v.getVideoPlaybackQuality().totalVideoFrames,
      rate: v.playbackRate,
      paused: v.paused,
    }));
  await page.waitForTimeout(5000);
  const after = await page.locator("#main").evaluate((v: HTMLVideoElement) => ({
    dropped: v.getVideoPlaybackQuality().droppedVideoFrames,
    total: v.getVideoPlaybackQuality().totalVideoFrames,
    rate: v.playbackRate,
    paused: v.paused,
  }));
  const tabs = await worker.evaluate(() => chrome.tabs.query({ active: true }));
  const tab = tabs[tabs.length - 1];
  const status = await worker.evaluate(
    async (id) =>
      chrome.tabs.sendMessage(id!, { type: "frameStatus" }, { frameId: 0 }),
    tab.id,
  );
  const gpu = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter({
      powerPreference: "low-power",
    });
    return a
      ? {
          vendor: a.info.vendor,
          architecture: a.info.architecture,
          device: a.info.device,
          description: a.info.description,
          isFallbackAdapter: a.info.isFallbackAdapter,
        }
      : null;
  });
  await writeFile(
    "test-results/stability.json",
    JSON.stringify(
      { browser: context.browser()?.version(), gpu, before, after, status },
      null,
      2,
    ),
  );
  expect(after.paused).toBe(false);
  expect(after.rate).toBe(before.rate);
  expect(after.total).toBeGreaterThan(before.total);
  expect(status.state).toBe("Enhancing");
  await page.close();
});

test("cover cropping keeps aspect ratio; unsafe rotations restore original", async () => {
  await settings({ enabled: true });
  const page = await fixture();
  await page.locator("#main").evaluate((v: HTMLVideoElement) => {
    v.style.width = "360px";
    v.style.objectFit = "cover";
  });
  await expect(page.locator("canvas[data-vanta]")).toBeAttached();
  await expect
    .poll(() =>
      page
        .locator("canvas[data-vanta]")
        .evaluate((c) => getComputedStyle(c).clipPath),
    )
    .not.toBe("none");
  const size = await page
    .locator("canvas[data-vanta]")
    .evaluate((c) => c.getBoundingClientRect().toJSON());
  expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  await page.locator("#main").evaluate((v: HTMLVideoElement) => {
    v.style.transform = "rotate(5deg)";
  });
  await expect(page.locator("canvas[data-vanta]")).toHaveCount(0);
  await page.close();
});
