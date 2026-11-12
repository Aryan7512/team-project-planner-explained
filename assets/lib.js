// Shared helpers. Every figure builds its DOM from recorded data through h(),
// which only ever creates text nodes, never HTML from strings.

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svgIcon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", kind === "ok" ? "M3.5 8.5l3 3 6-7" : "M4.5 4.5l7 7M11.5 4.5l-7 7");
  svg.append(path);
  return svg;
}

export const storage = {
  get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, value); } catch { /* private browsing: ignore */ } },
};

export function sourceLink(source, text) {
  return h("a", { href: source.url, title: `Open ${source.file} at line ${source.line} on GitHub` },
    text || `${source.file}:${source.line}`);
}

export async function load(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

/** Turns `code` spans in a sentence (as written in the README) into <code> elements. */
export function inlineCode(text) {
  return text.split(/(`[^`]+`)/).filter(Boolean)
    .map((part) => (part.startsWith("`") ? h("code", {}, part.slice(1, -1)) : part));
}

/** A legend that names the ids found in a piece of text. */
export function idLegend(text, labels) {
  const found = Object.entries(labels).filter(([id]) => text && text.includes(id));
  if (!found.length) return null;
  return h("dl", { class: "ids" }, found.map(([id, label]) => [h("dt", {}, `${id.slice(0, 8)}…`), h("dd", {}, label)]));
}

export function pretty(json) {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * Previous / Next / Play controls over a list of steps.
 * onShow(index) renders a step; the list on the left lets readers jump anywhere.
 */
export function stepper({ list, controls, count, title, onShow, autoplayMs = 1800 }) {
  let index = 0;
  let timer = null;
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const button = h("button", { type: "button", class: "steps-list__item", "aria-current": "false" }, title(i));
    button.addEventListener("click", () => { stop(); show(i); });
    list.append(h("li", {}, button));
    items.push(button);
  }
  const prev = h("button", { type: "button", class: "button button--quiet" }, "Previous");
  const next = h("button", { type: "button", class: "button button--quiet" }, "Next");
  const play = h("button", { type: "button", class: "button" }, "Play all");
  const where = h("span", { class: "pipeline__status", "aria-live": "polite" });
  controls.append(play, prev, next, where);

  function show(i) {
    index = Math.max(0, Math.min(count - 1, i));
    items.forEach((b, n) => b.setAttribute("aria-current", n === index ? "step" : "false"));
    prev.disabled = index === 0;
    next.disabled = index === count - 1;
    where.textContent = `Step ${index + 1} of ${count}`;
    onShow(index);
  }
  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    play.textContent = "Play all";
  }
  prev.addEventListener("click", () => { stop(); show(index - 1); });
  next.addEventListener("click", () => { stop(); show(index + 1); });
  play.addEventListener("click", () => {
    if (timer) { stop(); return; }
    if (reducedMotion.matches) { show(count - 1); return; }
    show(index === count - 1 ? 0 : index + 1);
    play.textContent = "Pause";
    timer = window.setInterval(() => {
      if (index >= count - 1) { stop(); return; }
      show(index + 1);
    }, autoplayMs);
  });
  show(0);
  return { show };
}

/** Renders one recorded API call: what was sent and what came back. */
export function callBlock(call, labels, service) {
  const head = h("div", { class: "call__head" },
    h("code", { class: "call__method" }, `${service}.${call.method}`),
    call.ok ? h("span", { class: "badge badge--ok" }, "returned") : h("span", { class: "badge badge--bad" }, call.exception));
  const parts = [head];
  if (call.request) parts.push(h("pre", { class: "code" }, call.request), idLegend(call.request, labels));
  if (call.ok) parts.push(h("pre", { class: "code code--result" }, call.body));
  else parts.push(h("p", { class: "call__error" }, call.message),
    h("p", { class: "result-meta" }, `Over HTTP: status ${call.http}, code "${call.code}".`));
  return h("div", { class: `call ${call.ok ? "" : "call--bad"}` }, parts);
}
