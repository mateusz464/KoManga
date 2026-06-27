// KoManga web-client build — "write modern, ship ancient".
//
// The Kobo Clara BW runs WebKit 538.1 (see docs/device.md, KWC-102): pure ES5,
// no ES2015 syntax and no ES2015 library globals. esbuild's lowest syntax floor
// is ES2015, so esbuild ALONE cannot produce a Kobo-safe bundle. The pipeline is
// therefore three stages:
//
//   1. esbuild  — bundle TS (+ the inlined core-js polyfills imported by
//                 src/main.ts) into one IIFE. Type-stripping + module bundling.
//   2. Babel    — @babel/preset-env targeting IE11 (an ES5 proxy) lowers every
//                 remaining ES2015+ construct (arrow fns, const/let, classes,
//                 template literals, optional chaining, ...) to ES5 syntax.
//   3. terser   — minify with `ecma: 5` so the minifier can never re-introduce
//                 newer syntax.
//
// Polyfills for the missing globals (Promise, Object.assign, Array.from, Map,
// Set, Symbol, ...) are NOT injected here — they are imported explicitly in
// src/polyfills.ts and bundled inline by stage 1, so the list is auditable.
//
// NOTE: source intentionally avoids async/await and generators for now; lowering
// those to ES5 additionally needs regenerator-runtime. Add it (and a polyfill
// import) when the app first needs them.

import { build as esbuild } from "esbuild";
import { transformAsync } from "@babel/core";
import { minify } from "terser";
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");

async function buildJs() {
  // Stage 1: bundle to a single ES2015 IIFE (esbuild's floor; Babel finishes).
  const bundled = await esbuild({
    entryPoints: [resolve(srcDir, "main.ts")],
    bundle: true,
    format: "iife",
    target: ["es2015"],
    platform: "browser",
    write: false,
    logLevel: "warning",
  });

  // Stage 2: down-level ES2015+ syntax to ES5. Polyfills already inlined, so
  // preset-env only rewrites syntax (useBuiltIns: false).
  const lowered = await transformAsync(bundled.outputFiles[0].text, {
    babelrc: false,
    configFile: false,
    compact: false,
    presets: [
      ["@babel/preset-env", { targets: { ie: "11" }, useBuiltIns: false }],
    ],
  });

  // Stage 3: minify with a hard ES5 ceiling.
  const min = await minify(lowered.code, {
    ecma: 5,
    compress: true,
    mangle: true,
  });

  return min.code;
}

async function buildCss() {
  // The CSS is already legacy-safe (-webkit-box, no custom properties); esbuild
  // only minifies it — it won't introduce modern syntax.
  const out = await esbuild({
    entryPoints: [resolve(srcDir, "styles.css")],
    bundle: true,
    minify: true,
    write: false,
    loader: { ".css": "css" },
  });
  return out.outputFiles[0].text;
}

async function main() {
  const [js, css] = await Promise.all([buildJs(), buildCss()]);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(resolve(distDir, "main.js"), js, "utf8");
  await writeFile(resolve(distDir, "styles.css"), css, "utf8");
  await copyFile(resolve(srcDir, "index.html"), resolve(distDir, "index.html"));

  console.log("build: wrote dist/index.html, dist/main.js, dist/styles.css");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
