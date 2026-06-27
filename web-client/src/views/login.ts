// Credential entry view (CLAUDE.md §6, RFC §6). One credential for the whole
// client: entered here, stored by AuthController (KWC-304), then attached to every
// request. Shown at first launch (no stored credential) and whenever a 401 routes
// us back here. This is the on-device credential-entry surface KWC-304 deferred to
// the app-shell ticket.

import { el } from "../render/dom.js";

export interface LoginViewOptions {
  // Called with the entered credential when the user submits a non-empty value.
  readonly onSubmit: (token: string) => void;
}

// Build the login view into `container`. No animation; the submit is a large tap
// target and the input is generously sized for on-panel legibility.
export function renderLogin(
  container: HTMLElement,
  options: LoginViewOptions,
): void {
  const form = el("div", { className: "login" });

  form.appendChild(el("h1", { text: "KoManga" }));
  form.appendChild(
    el("p", { text: "Enter your access credential to continue." }),
  );

  const input = el("input", { className: "credential" });
  input.type = "password";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-label", "Access credential");
  form.appendChild(input);

  const submit = el("button", { className: "tap", text: "Sign in" });
  submit.type = "button";
  submit.addEventListener("click", function () {
    const token = input.value.trim();
    if (!token) return;
    options.onSubmit(token);
  });
  form.appendChild(submit);

  container.appendChild(form);
}
