// Chapter 10: every endpoint with a real request and response, plus the error cases.

import { h, idLegend, pretty } from "../lib.js";

const HOST = "http://127.0.0.1:8000";

function curl(call) {
  const parts = [`curl -i ${call.method === "GET" ? "" : "-X POST "}${HOST}${call.path}`];
  if (call.method === "POST") {
    parts.push(`-H "Content-Type: ${call.content_type}"`);
    parts.push(`-d '${call.body}'`);
  }
  return parts.join(" \\\n     ");
}

export function renderHttp(root, data) {
  const groups = [
    ["Users", data.calls.filter((c) => c.path.startsWith("/api/users/"))],
    ["Teams", data.calls.filter((c) => c.path.startsWith("/api/teams/"))],
    ["Boards", data.calls.filter((c) => c.path.startsWith("/api/boards/"))],
    ["When something is wrong", data.errors],
  ];
  const seen = new Set();
  const buttons = [];
  const nav = h("div", { class: "endpoints" }, groups.map(([title, calls]) => h("section", {},
    h("p", { class: "label" }, title),
    h("ul", {}, calls.filter((c) => {
      const key = c.label + c.path + (c.status === 200 ? "" : c.status);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((c) => {
      const button = h("button", { type: "button", class: "endpoint", "aria-pressed": "false" },
        h("span", { class: `endpoint__method is-${c.method.toLowerCase()}` }, c.method),
        h("span", { class: "endpoint__name" }, c.status === 200 ? c.label : c.label),
        h("span", { class: `endpoint__status ${c.status === 200 ? "is-ok" : "is-bad"}` }, String(c.status)));
      button.addEventListener("click", () => show(c, button));
      buttons.push(button);
      return h("li", {}, button);
    })))));
  const detail = h("div", { class: "endpoint-detail", "aria-live": "polite" });

  function show(call, button) {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    detail.replaceChildren(...[
      h("p", { class: "label" }, "Request"),
      h("pre", { class: "code" }, curl(call)),
      idLegend(call.body || "", data.labels),
      call.note ? h("p", { class: "note" }, call.note) : null,
      h("p", { class: "label" }, "Response"),
      h("p", { class: "endpoint-detail__status" },
        h("span", { class: `badge ${call.status === 200 ? "badge--ok" : "badge--bad"}` }, `HTTP ${call.status}`),
        call.allow ? h("span", { class: "result-meta" }, ` Allow: ${call.allow}`) : null),
      h("pre", { class: "code code--result" }, pretty(call.response)),
      h("p", { class: "result-meta" }, "Response body indented for reading; the server sends it on one line.")].filter(Boolean));
  }

  root.replaceChildren(h("div", { class: "http" }, nav, detail),
    h("figcaption", {}, "Every request was sent to the planner's real Django views and every response is the one it gave. "
      + "The curl commands show the same requests as you would send them to a server started with python manage.py runserver."));
  show(data.calls[0], buttons[0]);
}
