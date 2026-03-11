import { existsSync, watch } from "node:fs";
import { join, normalize } from "node:path";
import { buildClient } from "../scripts/build-client";

const rootDir = Bun.cwd;
const distDir = join(rootDir, "dist");
const clientDir = join(rootDir, "src", "client");
const isDev = Bun.env.NODE_ENV !== "production";

async function ensureBuild() {
  if (isDev || !existsSync(join(distDir, "index.html"))) {
    await buildClient({ minify: !isDev });
  }
}

let rebuildTimer: ReturnType<typeof setTimeout> | undefined;

function watchClientFiles() {
  watch(clientDir, { recursive: true }, () => {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
    }

    rebuildTimer = setTimeout(async () => {
      try {
        await buildClient({ minify: false });
        console.log("Rebuilt client");
      } catch (error) {
        console.error(error);
      }
    }, 80);
  });
}

await ensureBuild();

if (isDev) {
  watchClientFiles();
}

const port = Number(Bun.env.PORT ?? 3000);

function resolveFilePath(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const requestedPath = decoded === "/" ? "/index.html" : decoded;
  const safePath = normalize(join(distDir, requestedPath));
  if (!safePath.startsWith(distDir)) {
    return join(distDir, "index.html");
  }

  return existsSync(safePath) ? safePath : join(distDir, "index.html");
}

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    const filePath = resolveFilePath(url.pathname);
    return new Response(Bun.file(filePath));
  },
});

console.log(`Graph visualizer running at http://localhost:${port}`);
