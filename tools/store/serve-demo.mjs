import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../../", import.meta.url);
const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ["tools/store/demo.tsx"],
  outfile: "demo.js",
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  target: ["chrome116"],
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".sql": "text" },
});
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SuperFLOW - fictional SQL demo</title>
<link rel="stylesheet" href="/demo.css"></head>
<body><div style="padding:6px 16px;font-size:12px;color:#486475;background:#e8f2f7">SuperFLOW preview | Fictional SQL | Local analysis | No database connection</div>
<div id="root"></div><script src="/demo.js"></script></body></html>`;
const assets = new Map([
  ["/", ["text/html; charset=utf-8", html]],
  ["/assets/superflow_cr.png", ["image/png", await readFile(new URL("extension/assets/superflow_cr.png", root))]],
]);
for (const file of result.outputFiles) {
  const css = file.path.endsWith(".css");
  assets.set(css ? "/demo.css" : "/demo.js", [css ? "text/css" : "text/javascript", file.contents]);
}
// Only generated demo resources are served, never arbitrary repository files.
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const asset = assets.get(pathname);
  response.writeHead(asset ? 200 : 404, {
    "Content-Type": asset?.[0] || "text/plain",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(asset?.[1] || "Not found");
});
server.listen(4178, "127.0.0.1", () => {
  console.log("Synthetic store demo: http://127.0.0.1:4178/?tabId=1");
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close());
}
