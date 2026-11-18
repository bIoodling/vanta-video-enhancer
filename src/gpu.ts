import { presets, type Quality } from "./state";
import { wgsl, vertexGL, fragmentGL } from "./shaders";
export interface Backend {
  name: string;
  limit: number;
  gpuMs?: number;
  readPixels?(): Promise<Uint8ClampedArray>;
  render(video: HTMLVideoElement, quality: Quality): Promise<void>;
  dispose(): void;
}
async function webgpu(canvas: HTMLCanvasElement): Promise<Backend> {
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "low-power",
  });
  if (!adapter) throw Error("WebGPU unavailable");
  const timestamps = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ["timestamp-query"] : [],
  });
  try {
    const context = canvas.getContext("webgpu");
    if (!context) throw Error("WebGPU canvas unavailable");
    let lost = false;
    device.lost.then(() => {
      lost = true;
    });
    let validation: Error | null = null;
    device.addEventListener("uncapturederror", (e) => {
      validation = Error(e.error.message);
    });
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: "opaque",
      colorSpace: "srgb",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    });
    const module = device.createShaderModule({ code: wgsl });
    const errors = (await module.getCompilationInfo()).messages.filter(
      (m) => m.type === "error",
    );
    if (errors.length) {
      device.destroy();
      throw Error(errors.map((e) => e.message).join(";"));
    }
    const pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
      }),
      buffers = [0, 1].map(() =>
        device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      );
    const queries = timestamps
      ? device.createQuerySet({ type: "timestamp", count: 4 })
      : null;
    const resolve = queries
      ? device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        })
      : null;
    const readback = queries
      ? device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        })
      : null;
    let gpuReadPending = false;
    let gpuMs: number | undefined,
      textures: GPUTexture[] = [];
    let size = "";
    let output: GPUTexture | null = null,
      outputSize = "";
    return {
      name: "WebGPU",
      get gpuMs() {
        return gpuMs;
      },
      limit: Math.min(device.limits.maxTextureDimension2D, 4096),
      async readPixels() {
        if (!output) throw Error("No rendered frame");
        const width = output.width,
          height = output.height,
          row = Math.ceil((width * 4) / 256) * 256;
        const buffer = device.createBuffer({
          size: row * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer(
            { texture: output },
            { buffer, bytesPerRow: row },
            [width, height],
          );
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          const src = new Uint8Array(buffer.getMappedRange()),
            pixels = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++)
            pixels.set(
              src.subarray(y * row, y * row + width * 4),
              y * width * 4,
            );
          if (format === "bgra8unorm")
            for (let i = 0; i < pixels.length; i += 4) {
              const r = pixels[i];
              pixels[i] = pixels[i + 2];
              pixels[i + 2] = r;
            }
          buffer.unmap();
          return pixels;
        } finally {
          buffer.destroy();
        }
      },
      async render(video, quality) {
        if (lost) throw Error("GPU device lost; disable and enable to retry");
        if (validation) throw validation;
        const w = video.videoWidth,
          h = video.videoHeight,
          key = `${w}x${h}`;
        if (
          w > device.limits.maxTextureDimension2D ||
          h > device.limits.maxTextureDimension2D ||
          w * h > 16777216
        )
          throw Error("Source exceeds safe texture budget");
        if (size !== key) {
          textures.forEach((t) => t.destroy());
          textures = [0, 1].map(() =>
            device.createTexture({
              size: [w, h],
              format,
              usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
            }),
          );
          size = key;
        }
        if (outputSize !== `${canvas.width}x${canvas.height}`) {
          output?.destroy();
          output = device.createTexture({
            size: [canvas.width, canvas.height],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          });
          outputSize = `${canvas.width}x${canvas.height}`;
        }
        device.queue.copyExternalImageToTexture(
          { source: video },
          { texture: textures[0], colorSpace: "srgb" },
          [w, h],
        );
        const measure = !!queries && !gpuReadPending;
        const preset = presets[quality],
          encoder = device.createCommandEncoder();
        for (let i = 0; i < 2; i++) {
          device.queue.writeBuffer(
            buffers[i],
            0,
            new Float32Array([
              w,
              h,
              canvas.width,
              canvas.height,
              preset.radius,
              preset.sharp,
              preset.denoise,
              i,
            ]),
          );
          const group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: textures[i].createView() },
              { binding: 1, resource: sampler },
              { binding: 2, resource: { buffer: buffers[i] } },
            ],
          });
          const pass = encoder.beginRenderPass({
            timestampWrites:
              queries && measure
                ? {
                    querySet: queries,
                    beginningOfPassWriteIndex: i * 2,
                    endOfPassWriteIndex: i * 2 + 1,
                  }
                : undefined,
            colorAttachments: [
              {
                view: i === 0 ? textures[1].createView() : output!.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.draw(3);
          pass.end();
        }
        encoder.copyTextureToTexture(
          { texture: output! },
          { texture: context.getCurrentTexture() },
          [canvas.width, canvas.height],
        );
        if (queries && resolve && readback && measure) {
          encoder.resolveQuerySet(queries, 0, 4, resolve, 0);
          encoder.copyBufferToBuffer(resolve, 0, readback, 0, 32);
        }
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        if (validation) throw validation;
        if (readback && measure) {
          gpuReadPending = true;
          // Reading timer data must not delay presentation or clear the canvas back buffer.
          void readback
            .mapAsync(GPUMapMode.READ)
            .then(() => {
              const t = new BigUint64Array(readback.getMappedRange());
              gpuMs = Number(t[1] - t[0] + t[3] - t[2]) / 1e6;
              readback.unmap();
            })
            .catch(() => {})
            .finally(() => {
              gpuReadPending = false;
            });
        }
      },
      dispose() {
        textures.forEach((t) => t.destroy());
        buffers.forEach((b) => b.destroy());
        queries?.destroy();
        resolve?.destroy();
        readback?.destroy();
        output?.destroy();
        context.unconfigure();
        device.destroy();
      },
    };
  } catch (e) {
    device.destroy();
    throw e;
  }
}
function webgl(canvas: HTMLCanvasElement): Backend {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw Error("GPU unavailable");
  function shader(type: number, source: string) {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, source);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      const msg = gl!.getShaderInfoLog(s);
      gl!.deleteShader(s);
      throw Error(msg || "Shader compile failed");
    }
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, vertexGL),
    fs = shader(gl.FRAGMENT_SHADER, fragmentGL),
    program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error("Shader link failed");
  const textures = [0, 1].map(() => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  });
  const framebuffer = gl.createFramebuffer()!;
  let size = "";
  return {
    name: "WebGL2",
    limit: Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    async render(video, quality) {
      if (gl.isContextLost()) throw Error("GPU context lost");
      const w = video.videoWidth,
        h = video.videoHeight;
      if (
        w > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
        h > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
        w * h > 16777216
      )
        throw Error("Source exceeds safe texture budget");
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures[0]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );
      if (size !== `${w}x${h}`) {
        gl.bindTexture(gl.TEXTURE_2D, textures[1]);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          w,
          h,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
        size = `${w}x${h}`;
      }
      gl.uniform2f(gl.getUniformLocation(program, "source"), w, h);
      const preset = presets[quality];
      for (const [key, value] of Object.entries(preset))
        gl.uniform1f(gl.getUniformLocation(program, key), value);
      for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, textures[i]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, i === 0 ? framebuffer : null);
        if (i === 0) {
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            textures[1],
            0,
          );
          if (
            gl.checkFramebufferStatus(gl.FRAMEBUFFER) !==
            gl.FRAMEBUFFER_COMPLETE
          )
            throw Error("Framebuffer unavailable");
        }
        gl.viewport(
          0,
          0,
          i === 0 ? w : canvas.width,
          i === 0 ? h : canvas.height,
        );
        gl.uniform1f(gl.getUniformLocation(program, "stageIndex"), i);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (gl.getError() !== gl.NO_ERROR) throw Error("GPU processing error");
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      await new Promise<void>((resolve, reject) => {
        const poll = () => {
          if (gl.isContextLost()) {
            gl.deleteSync(sync);
            reject(Error("GPU context lost"));
            return;
          }
          const state = gl.clientWaitSync(sync, 0, 0);
          if (state === gl.TIMEOUT_EXPIRED) setTimeout(poll, 1);
          else {
            gl.deleteSync(sync);
            state === gl.WAIT_FAILED
              ? reject(Error("GPU wait failed"))
              : resolve();
          }
        };
        poll();
      });
    },
    dispose() {
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
export async function createBackend(
  canvas: HTMLCanvasElement,
  forceGL = false,
): Promise<{
  backend: Backend;
  canvas: HTMLCanvasElement;
  fallbackReason?: string;
}> {
  let fallbackReason: string | undefined;
  if (!forceGL)
    try {
      return { backend: await webgpu(canvas), canvas };
    } catch (e) {
      fallbackReason = String(e);
    }
  // A canvas cannot change context types after acquisition.
  const replacement = canvas.cloneNode() as HTMLCanvasElement;
  return { backend: webgl(replacement), canvas: replacement, fallbackReason };
}
