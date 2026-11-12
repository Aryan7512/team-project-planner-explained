// Chapter 6: six processes racing to add users to one team, with and without the lock setting.

import { h, plural, sourceLink } from "../lib.js";

const MODE_LABEL = { immediate: "With the setting", deferred: "Without it" };
// Bars use 60% of the track so the label after the longest bar always fits.
const SPAN = 60;

function niceTicks(max) {
  const step = [5, 10, 20, 25, 50, 100].find((s) => max / s <= 6) || 200;
  const ticks = [];
  for (let t = 0; t <= max + 0.001; t += step) ticks.push(t);
  return ticks;
}

function outcomeOf(process, batch) {
  if (process.ok) return { cls: "is-ok", text: `added ${batch} users` };
  if (process.exception === "InvalidStateError") return { cls: "is-refused", text: "InvalidStateError: the team is full" };
  return { cls: "is-error", text: `${process.exception}: ${process.message}` };
}

function summariseAfter(paragraph, data) {
  const losers = (mode) => data.modes.find((m) => m.mode === mode).rounds.flatMap((r) => r.processes.filter((p) => !p.ok));
  const without = losers("deferred");
  const raw = without.filter((p) => p.exception === "OperationalError").length;
  const withSetting = losers("immediate");
  const code = (text) => h("code", {}, text);
  paragraph.replaceChildren(
    "Without the setting the cap still held, because SQLite refused the conflicting writes. But a losing request could get "
      + "back either the planner's ", code("InvalidStateError"), " or a raw ", code("OperationalError"), " saying ",
    h("q", {}, "database is locked"), ", depending on timing. In the runs above, ",
    `${raw} of the ${without.length} losing requests got the raw database error`,
    raw < without.length ? ` and ${without.length - raw} got ` : "", raw < without.length ? code("InvalidStateError") : "",
    `. With the setting, all ${withSetting.length} losing requests waited their turn and got `, code("InvalidStateError"), ".");
}

export function renderRace(root, data, setupNote, afterNote) {
  if (afterNote) summariseAfter(afterNote, data);
  if (setupNote) {
    setupNote.textContent = `To test it, ${data.processes} separate processes each tried to add ${data.batch_size} different `
      + `users to the same empty team at the same moment. Only one batch can fit, since two would make `
      + `${data.batch_size * 2}, over the limit of ${data.limit}. The experiment ran ${data.modes[0].rounds.length} times `
      + `with the setting and, for comparison, ${data.modes[1].rounds.length} times with that one line removed.`;
  }
  const max = Math.max(...data.modes.flatMap((m) => m.rounds.flatMap((r) => r.processes.map((p) => p.end_ms))));
  const ticks = niceTicks(max);
  const scale = ticks[ticks.length - 1] || max;
  let mode = 0;
  let round = 0;

  const modeButtons = data.modes.map((m, i) => h("button", { type: "button", class: "segmented__option", "aria-pressed": "false" }, MODE_LABEL[m.mode]));
  const roundButtons = data.modes[0].rounds.map((_, i) => h("button", { type: "button", class: "segmented__option", "aria-pressed": "false" }, `Run ${i + 1}`));
  const lanes = h("ol", { class: "race__lanes" });
  const axis = h("div", { class: "race__axis", "aria-hidden": "true" },
    ticks.map((t) => h("span", { style: `left: ${(t / scale) * SPAN}%` }, `${t} ms`)));
  const result = h("p", { class: "race__result", "aria-live": "polite" });

  const setting = h("div", { class: "race__setting" },
    h("p", { class: "label" }, "The setting, in ", sourceLink(data.setting, `planner_project/settings.py:${data.setting.line}`)),
    h("pre", { class: "code" }, data.setting.code));

  const summary = h("table", { class: "data-table" },
    h("thead", {}, h("tr", {}, ["", "Run", "Added", "Refused by the planner", "Failed in the database", "Team size after"].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, data.modes.flatMap((m) => m.rounds.map((r, i) => h("tr", {},
      h("th", { scope: "row" }, i === 0 ? MODE_LABEL[m.mode] : ""),
      h("td", {}, String(i + 1)),
      h("td", {}, String(r.processes.filter((p) => p.ok).length)),
      h("td", {}, String(r.processes.filter((p) => p.exception === "InvalidStateError").length)),
      h("td", {}, String(r.processes.filter((p) => !p.ok && p.exception !== "InvalidStateError").length)),
      h("td", {}, `${r.team_size} of ${data.limit}`))))));

  root.replaceChildren(
    h("div", { class: "race" },
      h("div", { class: "race__controls" },
        h("div", { class: "segmented", role: "group", "aria-label": "Setting" }, modeButtons),
        h("div", { class: "segmented", role: "group", "aria-label": "Run" }, roundButtons)),
      h("div", { class: "race__chart" }, lanes, axis),
      result,
      h("div", { class: "race__bottom" }, setting, h("div", {}, h("p", { class: "label" }, "Every run"), summary))),
    h("figcaption", {}, "Each bar is one process, from the moment it called add_users_to_team to the moment it got an answer, "
      + "in milliseconds after all of them started. All runs share one time scale. "
      + "“Without it” is the same code with the one setting removed, run only for this experiment."));

  function show() {
    modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === mode)));
    roundButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === round)));
    const run = data.modes[mode].rounds[round];
    lanes.replaceChildren(...run.processes.map((p, n) => {
      const outcome = outcomeOf(p, data.batch_size);
      const bar = h("span", { class: `race__bar ${outcome.cls}`, style: `left: ${(p.start_ms / scale) * SPAN}%; width: 0` });
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${Math.max(((p.end_ms - p.start_ms) / scale) * SPAN, 0.6)}%`; }));
      return h("li", { class: "race__lane", "aria-label": `Process ${n + 1}: ${outcome.text}, answered after ${Math.round(p.end_ms)} ms` },
        h("span", { class: "race__name" }, `Process ${n + 1}`),
        h("span", { class: "race__track" }, bar,
          h("span", { class: `race__text ${outcome.cls}`, style: `left: calc(${(p.end_ms / scale) * SPAN}% + 0.5rem)` },
            `${outcome.text} · ${Math.round(p.end_ms)} ms`)));
    }));
    const added = run.processes.filter((p) => p.ok).length;
    const refused = run.processes.filter((p) => p.exception === "InvalidStateError").length;
    const failed = run.processes.length - added - refused;
    const parts = [`${plural(added, "process", "processes")} added ${data.batch_size} users`];
    if (refused) parts.push(`${refused} got InvalidStateError from the planner`);
    if (failed) parts.push(`${failed} failed with OperationalError: ${run.processes.find((p) => !p.ok && p.exception !== "InvalidStateError").message}`);
    result.replaceChildren(h("b", {}, `Team size afterwards: ${run.team_size} of ${data.limit}.`), " ",
      `${parts.join("; ")}.`);
  }
  modeButtons.forEach((b, i) => b.addEventListener("click", () => { mode = i; show(); }));
  roundButtons.forEach((b, i) => b.addEventListener("click", () => { round = i; show(); }));
  show();
}
