// Small framework-free DOM helpers (CLAUDE.md §5: render/ owns DOM building).
// Views build their elements through here so construction stays uniform and the
// refresh policy (refresh.ts) remains the only thing that triggers a repaint.

// Create an element with an optional class and text. Authored modern; the build
// (esbuild → Babel → terser) down-levels it to ES5 for WebKit 538.1.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  return node;
}

// A large, tap-friendly button (CLAUDE.md §7: large targets on e-ink). Binds the
// tap as a `click`: Nickel synthesises a click from a tap, and click also keeps
// the shell usable in a desktop browser during development. No hover/active
// transitions — they smear on e-ink (KWC-103).
export function tapButton(label: string, onTap: () => void): HTMLButtonElement {
  const btn = el("button", { className: "tap", text: label });
  btn.type = "button";
  btn.addEventListener("click", function () {
    onTap();
  });
  return btn;
}

// Remove every child of a node in one pass (minimise repaints — CLAUDE.md §7).
export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
