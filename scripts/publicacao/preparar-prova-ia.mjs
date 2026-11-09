/** Bundle do SDK já travado no lockfile; o standalone do Next pode não externalizá-lo. */
import { build } from "esbuild";
await build({ entryPoints: ["scripts/publicacao/prova-ia.mjs"], outfile: process.argv[2],
  bundle: true, platform: "node", format: "cjs", minify: true, logLevel: "error" });
