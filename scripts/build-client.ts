import { copyFile as copyFileFs, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const rootDir = Bun.cwd;
const clientDir = join(rootDir, "src", "client");
const distDir = join(rootDir, "dist");
const assetDir = join(distDir, "assets");

async function copyFile(sourcePath: string, destinationPath: string) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFileFs(sourcePath, destinationPath);
}

export async function buildClient(options: { minify?: boolean } = {}) {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(assetDir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(clientDir, "main.ts")],
    outdir: assetDir,
    target: "browser",
    format: "esm",
    minify: options.minify ?? false,
    sourcemap: options.minify ? "none" : "external",
    splitting: false,
  });

  if (!result.success) {
    const errors = result.logs.map((entry) => entry.message).join("\n");
    throw new Error(`Client build failed:\n${errors}`);
  }

  await copyFile(join(clientDir, "index.html"), join(distDir, "index.html"));
  await copyFile(join(clientDir, "styles.css"), join(distDir, "styles.css"));
}
