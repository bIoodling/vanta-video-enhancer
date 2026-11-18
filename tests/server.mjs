import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { build } from "esbuild";
await build({
  entryPoints: ["tests/harness.ts"],
  outfile: "test-results/harness.js",
  bundle: true,
  format: "iife",
  globalName: "VantaTest",
});
createServer(async (req, res) => {
  try {
    const path = resolve(
      ".",
      "." +
        decodeURIComponent(
          req.url.split("?")[0] === "/"
            ? "/tests/fixture.html"
            : req.url.split("?")[0],
        ),
    );
    if (
      !path.startsWith(resolve(".") + "/") &&
      !path.startsWith(resolve(".") + "\\")
    )
      throw Error();
    const file = await readFile(path);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(4173, "0.0.0.0");
