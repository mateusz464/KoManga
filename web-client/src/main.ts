import "./polyfills";

// KWC-307 — app shell & e-ink render policy.
//
// The shell is the persistent chrome: a tap-based nav bar plus a content area the
// router swaps views into. It wires the three framework-free pieces together —
// AuthController (state), Router (router), render/ (paint policy) — and gates
// rendering on auth: until a credential is stored it shows the login view, and a
// 401 from any later call (AuthController.onRequireLogin) drops back to it.
//
// The feature views (4xx/5xx/6xx) are stubbed as placeholders for now; each
// ticket replaces its stub. The ApiClient is wired by those consuming tickets
// (KWC-302) — the shell only needs auth + router + render.

import { AuthController } from "./state/auth.js";
import { Router } from "./router/router.js";
import type { Route } from "./router/routes.js";
import { renderView } from "./render/refresh.js";
import { tapButton } from "./render/dom.js";
import { renderLogin } from "./views/login.js";
import { renderPlaceholder } from "./views/placeholder.js";

function start(): void {
  const root = document.getElementById("app");
  if (!root) return;

  // A 401 from any call clears the credential and routes back to login.
  const auth = new AuthController({
    onRequireLogin: function () {
      showLogin();
    },
  });

  const router = new Router({
    onChange: function (route) {
      renderRoute(route);
    },
  });

  // Build the shell once: a nav bar + a content area. Views render into
  // `content`; the refresh policy repaints on every swap.
  const nav = document.createElement("div");
  nav.id = "nav";
  nav.appendChild(
    tapButton("Library", function () {
      router.navigate({ name: "library" });
    }),
  );
  nav.appendChild(
    tapButton("Search", function () {
      router.navigate({ name: "search" });
    }),
  );

  const content = document.createElement("div");
  content.id = "content";

  root.innerHTML = "";
  root.appendChild(nav);
  root.appendChild(content);

  function setNavHidden(hidden: boolean): void {
    nav.style.display = hidden ? "none" : "";
  }

  function showLogin(): void {
    setNavHidden(true);
    renderView(content, function (container) {
      renderLogin(container, {
        onSubmit: function (token) {
          auth.login(token);
          // Now authenticated — render whatever route we are on.
          renderRoute(router.current());
        },
      });
    });
  }

  function renderRoute(route: Route): void {
    // Auth gate: no credential → always the login view, whatever the route.
    if (!auth.isAuthenticated()) {
      showLogin();
      return;
    }
    // The reader is full-screen (no nav chrome); every other view keeps the nav.
    setNavHidden(route.name === "reader");
    renderView(content, function (container) {
      renderViewFor(route, container);
    });
  }

  // Map a route to its view. Real views land in later tickets; placeholders keep
  // the nav and refresh policy demonstrable on-device meanwhile.
  function renderViewFor(route: Route, container: HTMLElement): void {
    switch (route.name) {
      case "library":
        renderPlaceholder(container, { title: "Library" });
        return;
      case "search":
        renderPlaceholder(container, {
          title: "Search",
          detail: route.query ? 'Query: "' + route.query + '"' : undefined,
        });
        return;
      case "manga":
        renderPlaceholder(container, {
          title: "Manga",
          detail: "ID: " + route.mangaId,
        });
        return;
      case "reader":
        renderPlaceholder(container, {
          title: "Reader",
          detail: "Chapter: " + route.chapterId,
        });
        return;
    }
  }

  // start() emits the initial route synchronously via onChange → renderRoute.
  router.start();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
