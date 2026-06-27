import "./polyfills";

// KWC-201 trivial page: a smoke test for the whole "write modern, ship ancient"
// pipeline. It is deliberately authored with ES2015+ constructs (arrow fns,
// const, template literals) and ES2015 globals (Promise, Object.assign,
// Array.from) so that a clean render on the real Kobo proves BOTH the ES5
// transpile and the polyfills are working on WebKit 538.1.

const mount = (): void => {
  const root = document.getElementById("app");
  if (!root) return;

  const info = Object.assign(
    {},
    { engine: "WebKit 538.1", build: "ES5 + polyfills" },
  );
  const checks = Array.from(["Promise", "Object.assign", "Array.from"]);

  // Promise proves the polyfill; no async/await (would need regenerator on ES5).
  Promise.resolve().then(() => {
    root.innerHTML = "";

    const heading = document.createElement("h1");
    heading.textContent = "KoManga";

    const status = document.createElement("p");
    status.textContent = `Build pipeline OK — ${info.build} (${info.engine})`;

    const list = document.createElement("ul");
    checks.forEach((name) => {
      const item = document.createElement("li");
      item.textContent = `${name} ✓`;
      list.appendChild(item);
    });

    root.appendChild(heading);
    root.appendChild(status);
    root.appendChild(list);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
