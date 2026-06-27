// ES2015+ library globals the Kobo's WebKit 538.1 lacks (docs/device.md, KWC-102:
// "no Promise, Map, Set, Symbol; no Object.assign, Array.from, Array.includes").
// Imported first by main.ts so esbuild inlines them at the top of the bundle.
// Targeted imports only — never `import "core-js"` wholesale — to keep the
// bundle small on the slow-parsing old WebKit. Add more as the client uses them.
//
// DELIBERATELY OMITTED: Symbol / Map / Set. On-device (KWC-201 smoke) core-js's
// global `Symbol` polyfill throws "Incompatible receiver, Symbol required" at
// install time — WebKit 538.1 ships a partial/broken Symbol that core-js trips
// over. Nothing here needs them yet; add them back ONLY with a Symbol-free
// strategy (or guarded) and re-verify on-device when a ticket first requires
// Map/Set/Symbol.
import "core-js/stable/promise";
import "core-js/stable/object/assign";
import "core-js/stable/array/from";
import "core-js/stable/array/includes";
