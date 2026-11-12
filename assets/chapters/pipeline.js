// Chapter 2: one request through the five steps, replayed from recorded runs.

import { h, reducedMotion, sourceLink, svgIcon } from "../lib.js";

const STAGES = [
  { key: "parse", name: "Parse", title: "1 · Parse" },
  { key: "check", name: "Check", title: "2 · Check" },
  { key: "rules", name: "Rules", title: "3 · Rules" },
  { key: "save", name: "Save", title: "4 · Save" },
  { key: "reply", name: "Reply", title: "5 · Reply" },
];
const STEP_MS = 950;
const MODEL_LABELS = { User: "Users", Team: "Teams", TeamMembership: "Memberships", Board: "Boards", Task: "Tasks" };

function describeCheck(event) {
  if (!event.ok) return event.error;
  switch (event.helper) {
    case "text_field":
      return event.absent ? "not sent; optional" : `${event.length} characters, limit ${event.limit}`;
    case "id_field": return "a non-empty id";
    case "id_list_field": return `${event.count} ${event.count === 1 ? "id" : "ids"}, limit ${event.limit}`;
    case "object_field": return "an object";
    case "choice_field": return `one of ${event.choices.join(", ")}`;
    default: return "checked";
  }
}

function checkList(rows) {
  return h("ul", { class: "checks" }, rows.map((row) => h("li", { class: row.ok ? "ok" : "bad" },
    h("span", { class: "mark", "aria-label": row.ok ? "passed" : "failed" }, row.ok ? "✓" : "✗"),
    h("span", { class: "field" }, row.field),
    h("span", { class: "detail" }, row.detail),
  )));
}

const sqlBlocks = (queries) => queries.map((q) => h("pre", { class: "code code--sql" }, q.sql));
const tag = (text, kind) => h("span", { class: `sql-tag ${kind ? `is-${kind}` : ""}` }, text);

function raisedBlock(outcome) {
  const where = outcome.raised_at;
  return [
    h("pre", { class: "code code--source" }, where.code),
    h("p", { class: "note" }, `${outcome.exception}: ${outcome.message}`),
  ];
}

function entryBody(stage, scenario) {
  const { outcome, sql, events } = scenario;
  const failed = stage.status === "failed";
  const skipped = stage.status === "skipped";
  const ranQueries = sql.length > 0;
  const rolledBack = sql.some((q) => q.sql === "ROLLBACK");

  switch (stage.key) {
    case "parse": {
      if (failed) return [h("p", {}, "The text is not valid JSON, so the request stops here."), ...raisedBlock(outcome)];
      const parsed = events.find((e) => e.helper === "parse_request");
      return [h("p", { class: "note" }, "Valid JSON. It decodes to an object with the keys ",
        ...parsed.keys.flatMap((key, i) => [i ? ", " : "", h("code", {}, key)]), ".")];
    }
    case "check": {
      if (skipped) return [h("p", {}, "Skipped.")];
      const rows = events.filter((e) => !["parse_request", "get_by_id", "get_many_by_id"].includes(e.helper))
        .map((e) => ({ ok: e.ok, field: e.field, detail: describeCheck(e) }));
      return [checkList(rows), failed ? h("p", {}, "This field breaks its limit, so the request stops here.") : null,
        ...(failed ? raisedBlock(outcome) : [])];
    }
    case "rules": {
      if (skipped) return [h("p", {}, ranQueries ? "Skipped." : "Skipped. No query ran: the request never reached the database.")];
      const lookups = events.filter((e) => e.helper === "get_by_id" || e.helper === "get_many_by_id")
        .map((e) => ({ ok: e.ok, field: e.label, detail: e.ok ? `found: ${e.found.join(", ")}` : e.error }));
      const parts = [];
      if (sql.some((q) => q.sql.startsWith("BEGIN"))) {
        parts.push(h("p", { class: "note" }, tag("BEGIN IMMEDIATE"), " A transaction starts and takes the database's write lock."));
      }
      if (lookups.length) parts.push(checkList(lookups));
      parts.push(...sqlBlocks(sql.filter((q) => q.kind === "read")));
      if (failed) {
        parts.push(h("p", {}, "A rule is broken, so the request stops here."), ...raisedBlock(outcome));
        if (rolledBack) parts.push(h("p", { class: "note" }, tag("ROLLBACK", "rollback"), " The transaction is undone."));
      } else {
        parts.push(h("p", { class: "note" }, "No rule is broken, so the request goes on."));
      }
      return parts;
    }
    case "save": {
      if (skipped) {
        return [h("p", {}, rolledBack
          ? "Skipped. The transaction ended with ROLLBACK, so nothing was written."
          : "Skipped. Nothing was written.")];
      }
      return [...sqlBlocks(sql.filter((q) => q.kind === "write")),
        h("p", { class: "note" }, tag("COMMIT", "commit"), " The change is written and the transaction commits.")];
    }
    case "reply": {
      if (skipped) return [h("p", {}, "Skipped. Instead of returning, the method raises ", h("code", {}, outcome.exception), ".")];
      return [h("p", { class: "note" }, "The method returns a JSON string:"), h("pre", { class: "code" }, outcome.body)];
    }
    default: return [];
  }
}

export function setupPipeline(root, data) {
  const parts = {
    scenarios: root.querySelector("[data-scenarios]"),
    track: root.querySelector("[data-track]"),
    fill: root.querySelector("[data-fill]"),
    stops: root.querySelector("[data-stops]"),
    log: root.querySelector("[data-log]"),
    status: root.querySelector("[data-status]"),
    replay: root.querySelector("[data-replay]"),
    step: root.querySelector("[data-step]"),
    call: root.querySelector("[data-call]"),
    ids: root.querySelector("[data-ids]"),
    result: root.querySelector("[data-result]"),
    rows: root.querySelector("[data-rows]"),
    setup: root.querySelector("[data-setup]"),
  };
  parts.setup.textContent = data.setup.join(" ");

  const stopNodes = STAGES.map((stage, index) => {
    const dot = h("span", { class: "stop__dot" }, String(index + 1));
    const li = h("li", { class: "stop" }, dot, h("span", { class: "stop__name" }, stage.name));
    parts.stops.append(li);
    return { li, dot };
  });

  const buttons = data.scenarios.map((scenario) => {
    const button = h("button", { type: "button", class: "scenario", "aria-pressed": "false" },
      h("span", { class: "scenario__title" }, scenario.title),
      h("span", { class: "scenario__method" }, `${scenario.service}.`, h("wbr"), scenario.method));
    button.addEventListener("click", () => select(scenario, button, true));
    parts.scenarios.append(button);
    return button;
  });

  let current = null;
  let shown = -1;
  let timer = null;

  const stopIndex = () => STAGES.findIndex((s) => s.key === current.stopped_at);
  const failed = () => current.outcome.kind === "error";

  function renderCall() {
    parts.call.textContent = current.python;
    const ids = Object.entries(data.labels).filter(([id]) => current.request.includes(id));
    parts.ids.replaceChildren(...ids.flatMap(([id, label]) => [h("dt", {}, `${id.slice(0, 8)}…`), h("dd", {}, label)]));
  }

  function renderRows(done) {
    const before = current.rows_before;
    const after = current.rows_after;
    parts.rows.replaceChildren(
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Table"), h("th", { scope: "col", style: "text-align:right" }, "Before"),
        h("th", { scope: "col", style: "text-align:right" }, "After"))),
      h("tbody", {}, Object.keys(before).map((model) => h("tr", { class: done && before[model] !== after[model] ? "is-changed" : null },
        h("th", { scope: "row" }, MODEL_LABELS[model] || model),
        h("td", {}, String(before[model])),
        h("td", {}, done ? String(after[model]) : "…")))),
    );
  }

  function renderResult(done) {
    if (!done) { parts.result.replaceChildren(h("p", { class: "result-pending" }, "Waiting for the request to finish…")); return; }
    const outcome = current.outcome;
    if (outcome.kind === "response") {
      parts.result.replaceChildren(h("pre", { class: "code" }, outcome.body),
        h("p", { class: "result-meta" }, `returned by ${current.service}.${current.method}`));
      return;
    }
    parts.result.replaceChildren(h("div", { class: "result-error" },
      h("div", { class: "result-error__name" }, outcome.exception, outcome.builtin ? h("span", {}, ` (a ${outcome.builtin})`) : null),
      h("p", {}, outcome.message),
      h("p", { class: "result-meta" }, `Over HTTP: status ${outcome.http}, code "${outcome.code}". Raised at `,
        sourceLink(outcome.raised_at), "."),
    ));
  }

  function entry(stage, index) {
    const status = stage.status;
    const where = status === "failed" && current.outcome.raised_at ? current.outcome.raised_at : stage.source;
    return h("li", { class: `entry is-hidden is-${status}`, "data-index": String(index) },
      h("div", { class: "entry__head" },
        h("span", { class: "entry__title" }, `${STAGES[index].title}${status === "skipped" ? " · skipped" : status === "failed" ? " · stopped" : ""}`),
        h("span", { class: "entry__where" }, sourceLink(where))),
      ...entryBody(stage, current));
  }

  function paintTrack() {
    stopNodes.forEach(({ li, dot }, index) => {
      li.className = "stop";
      dot.replaceChildren(String(index + 1));
      if (index <= shown) {
        const status = current.stages[index].status;
        li.classList.add(`is-${status}`);
        if (status === "passed") dot.replaceChildren(svgIcon("ok"));
        if (status === "failed") dot.replaceChildren(svgIcon("bad"));
      } else if (index === shown + 1) {
        li.classList.add("is-active");
      }
    });
    const reached = Math.min(Math.max(shown, 0), stopIndex());
    parts.fill.style.width = `${(reached / (STAGES.length - 1)) * 100}%`;
    parts.track.classList.toggle("is-failed", failed() && shown >= stopIndex());
  }

  function reveal(index) {
    const entries = parts.log.children;
    const finishing = index >= stopIndex();
    shown = finishing ? STAGES.length - 1 : index;
    for (let i = index; i <= shown; i += 1) entries[i].classList.remove("is-hidden");
    paintTrack();
    const name = STAGES[index].name;
    if (!finishing) parts.status.textContent = `Step ${index + 1} of 5: ${name} passed.`;
    else if (failed()) parts.status.textContent = `Stopped at step ${index + 1}, ${name}: ${current.outcome.message}`;
    else parts.status.textContent = "All five steps passed. The change is saved.";
    renderResult(finishing);
    renderRows(finishing);
    parts.step.disabled = finishing;
  }

  function nextStep() {
    if (shown >= stopIndex()) return false;
    reveal(shown + 1);
    return shown < stopIndex();
  }

  function stopTimer() { if (timer) { window.clearTimeout(timer); timer = null; } }

  function play() {
    stopTimer();
    if (reducedMotion.matches) { while (nextStep()) { /* jump to the end */ } return; }
    const tick = () => { if (nextStep()) timer = window.setTimeout(tick, STEP_MS); else timer = null; };
    timer = window.setTimeout(tick, 250);
  }

  function select(scenario, button, autoplay) {
    stopTimer();
    current = scenario;
    shown = -1;
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    parts.log.replaceChildren(...current.stages.map(entry));
    parts.status.textContent = "";
    parts.step.disabled = false;
    renderCall();
    renderResult(false);
    renderRows(false);
    paintTrack();
    if (autoplay) play();
  }

  parts.replay.addEventListener("click", () => select(current, buttons[data.scenarios.indexOf(current)], true));
  parts.step.addEventListener("click", () => { stopTimer(); nextStep(); });

  select(data.scenarios[0], buttons[0], false);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); if (shown < 0) play(); }
  }, { threshold: 0.35 });
  observer.observe(root);
}
