// Chapter 5: a board's life from open to closed, through recorded calls.

import { callBlock, h, stepper } from "../lib.js";

const COLUMNS = [["OPEN", "Open"], ["IN_PROGRESS", "In progress"], ["COMPLETE", "Complete"]];

export function renderBoard(root, data) {
  const list = h("ol", { class: "steps-list" });
  const controls = h("div", { class: "stepper__controls" });
  const board = h("div", { class: "kanban" });
  const calls = h("div", { class: "calls", "aria-live": "polite" });

  root.replaceChildren(h("div", { class: "stepper" },
    h("div", { class: "stepper__side" }, h("p", { class: "label" }, "Calls on board Sprint 1"), list),
    h("div", { class: "stepper__main" }, controls, board, calls)),
    h("figcaption", {}, "Each step is one or more real calls, recorded in order. The columns show the board as it was "
      + "stored after the step."));

  stepper({
    list, controls, count: data.steps.length,
    title: (i) => {
      const ok = data.steps[i].calls.every((c) => c.ok);
      return [h("span", { class: `steps-list__mark ${ok ? "is-ok" : "is-bad"}` }, ok ? "✓" : "✗"), h("span", {}, data.steps[i].summary)];
    },
    onShow: (i) => {
      const step = data.steps[i];
      const before = i ? data.steps[i - 1].board : null;
      const state = step.board;
      const moved = (task) => before && before.tasks.find((t) => t.title === task.title)?.status !== task.status;
      const closed = state.status === "CLOSED";
      board.replaceChildren(
        h("div", { class: "kanban__head" },
          h("h3", {}, "Sprint 1"),
          h("span", { class: `status-badge ${closed ? "is-closed" : "is-open"}` }, state.status),
          h("span", { class: "kanban__end" }, closed ? `end_time ${state.end_time}` : "end_time not set")),
        h("div", { class: `kanban__columns ${closed ? "is-closed" : ""}` }, COLUMNS.map(([status, label]) => {
          const tasks = state.tasks.filter((t) => t.status === status);
          return h("section", { class: "kanban__column" },
            h("h4", {}, label, h("span", {}, String(tasks.length))),
            tasks.length ? tasks.map((t) => h("div", { class: `task-card ${moved(t) || (before && !before.tasks.some((b) => b.title === t.title)) ? "is-changed" : ""}` },
              h("span", { class: "task-card__title" }, t.title), h("span", { class: "task-card__who" }, t.assignee)))
              : h("p", { class: "kanban__empty" }, "No tasks"));
        })));
      calls.replaceChildren(...step.calls.map((call) => callBlock(call, data.labels, "ProjectBoardService")));
    },
  });
}
