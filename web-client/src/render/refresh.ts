// The ONE place the e-ink refresh policy lives (CLAUDE.md §5/§7/§12, KWC-103).
//
// This Nickel/WebKit build (Clara BW, 538.1) does not reliably repaint on its
// own: the spike saw content stay unpainted until a later event forced a repaint
// (docs/device.md §KWC-103). So every view change must (a) swap content in a
// single operation and (b) force an explicit full repaint, which also clears any
// ghost residue. Views describe WHAT to show; this module decides HOW to paint it
// — no view triggers a repaint itself.

import { clearChildren } from "./dom.js";

// Force a full repaint of a subtree. Toggling it off then on (with a synchronous
// reflow committed in between) invalidates the whole subtree, so WebKit re-lays
// out and repaints it — the explicit trigger the panel needs on a view change
// (KWC-103). This is a single synchronous reflow: no timers and no transition, so
// the no-animation rule stands (CLAUDE.md §7). A stepped black→white "flash" is
// deliberately avoided — it would need a frame yield (i.e. animation); the spike
// rated in-place, in-viewport swaps clean with no visible ghost, so a synchronous
// reflow is enough.
export function forceFullRefresh(root: HTMLElement): void {
  root.style.display = "none";
  // Reading a layout property forces the "hidden" state to commit before we show
  // it again, so the toggle actually invalidates paint rather than coalescing.
  void root.offsetHeight;
  root.style.display = "";
  void root.offsetHeight;
}

// Swap a container's contents to a freshly built view and force a full refresh.
// The single entry point the shell uses on every navigation: build the new view
// off the live tree, replace all children at once (one repaint, not many), then
// trigger the panel repaint.
export function renderView(
  root: HTMLElement,
  build: (container: HTMLElement) => void,
): void {
  const next = document.createElement("div");
  next.className = "view";
  build(next);
  clearChildren(root);
  root.appendChild(next);
  forceFullRefresh(root);
}
