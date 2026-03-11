import { buildClient } from "./build-client";

await buildClient({ minify: true });
console.log("Built graph visualizer into ./dist");
