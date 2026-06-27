// Placeholder view for the routes whose real UI lands in later tickets (browse
// 4xx, reader 5xx, library 6xx). The app shell (KWC-307) renders these so the
// nav and the refresh policy are demonstrable on-device now; each feature ticket
// replaces its placeholder with the real view. It states the view name and any
// route params plainly so navigation is observable on the panel.

import { el } from "../render/dom.js";

export interface PlaceholderOptions {
  readonly title: string;
  readonly detail?: string;
}

export function renderPlaceholder(
  container: HTMLElement,
  options: PlaceholderOptions,
): void {
  const wrap = el("div", { className: "placeholder" });
  wrap.appendChild(el("h1", { text: options.title }));
  if (options.detail !== undefined) {
    wrap.appendChild(el("p", { className: "detail", text: options.detail }));
  }
  wrap.appendChild(el("p", { className: "stub", text: "Coming soon." }));
  container.appendChild(wrap);
}
