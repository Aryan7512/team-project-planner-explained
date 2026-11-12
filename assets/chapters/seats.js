// Chapter 4: one team's fifty seats through a recorded sequence of requests.

import { h, plural, stepper } from "../lib.js";

/** Seat positions are display only: members keep their seat, and new members fill free seats in order. */
function seatPlan(steps, limit) {
  const plans = [];
  let seats = Array(limit).fill(null);
  for (const step of steps) {
    seats = seats.map((name) => (name && step.removed.includes(name) ? null : name));
    for (const name of step.added) {
      const free = seats.indexOf(null);
      if (free >= 0) seats[free] = name;
    }
    plans.push([...seats]);
  }
  return plans;
}

function wouldAdd(step, previous) {
  if (step.result.ok || step.kind !== "add") return [];
  return step.sent.filter((name) => name === null || !previous.includes(name));
}

export function renderSeats(root, data) {
  const plans = seatPlan(data.steps, data.limit);
  const list = h("ol", { class: "steps-list" });
  const controls = h("div", { class: "stepper__controls" });
  const grid = h("div", { class: "seats", role: "img" });
  const admin = h("div", { class: "seat-admin" },
    h("span", { class: "seat seat--admin", "aria-hidden": "true" }, data.admin.slice(0, 2)),
    h("span", {}, h("b", {}, `admin: ${data.admin}`), h("br"), data.admin_is_member ? "also a member" : "not a member, so not in a seat"));
  const counter = h("p", { class: "seats__count" });
  const message = h("div", { class: "seats__message", "aria-live": "polite" });
  const overflow = h("div", { class: "seats__overflow" });

  root.replaceChildren(h("div", { class: "stepper" },
    h("div", { class: "stepper__side" }, h("p", { class: "label" }, `Requests to team ${data.team.name}`), list),
    h("div", { class: "stepper__main" }, controls,
      h("div", { class: "seats__stage" }, h("div", { class: "seats__wrap" }, grid, overflow), admin),
      counter, message)),
    h("figcaption", {}, `Each step is one real call to add_users_to_team or remove_users_from_team, recorded in order. `
      + `The seats show the members that list_team_users returned after it; where each person sits is only for display.`));

  stepper({
    list, controls, count: data.steps.length,
    title: (i) => [h("span", { class: `steps-list__mark ${data.steps[i].result.ok ? "is-ok" : "is-bad"}` }, data.steps[i].result.ok ? "✓" : "✗"),
      h("span", {}, data.steps[i].summary)],
    onShow: (i) => {
      const step = data.steps[i];
      const previous = i ? data.steps[i - 1].members : [];
      const seats = plans[i];
      const ghosts = wouldAdd(step, previous);
      const free = seats.map((n, k) => (n ? -1 : k)).filter((k) => k >= 0);
      grid.replaceChildren(...seats.map((name, k) => {
        const ghostIndex = free.indexOf(k);
        const ghost = !name && ghostIndex >= 0 && ghostIndex < ghosts.length;
        const freed = !name && i > 0 && Boolean(plans[i - 1][k]);
        const cls = name ? (step.added.includes(name) ? "seat seat--new" : "seat seat--taken")
          : ghost ? "seat seat--ghost" : freed ? "seat seat--freed" : "seat";
        return h("span", { class: cls, title: name || (ghost ? "would have been added, but the request was refused" : "empty seat") }, name ? name.slice(-2) : "");
      }));
      const spill = Math.max(0, ghosts.length - free.length);
      overflow.replaceChildren(...Array.from({ length: spill }, (_, n) => h("span", { class: "seat seat--ghost", title: `would be member number ${data.limit + n + 1}` }, String(data.limit + n + 1))));
      grid.setAttribute("aria-label", `${step.members.length} of ${data.limit} seats taken`);
      counter.replaceChildren(h("b", {}, `${step.members.length} of ${data.limit}`), " seats taken");

      const sent = step.sent.map((n) => n ?? "an unknown id");
      const shown = sent.length > 8 ? `${sent.slice(0, 4).join(", ")} … ${sent.slice(-2).join(", ")}` : sent.join(", ");
      const outcome = step.result.ok
        ? h("p", {}, h("span", { class: "badge badge--ok" }, "returned {}"), " ",
          step.added.length ? `${plural(step.added.length, "member")} added.` : step.removed.length ? `${plural(step.removed.length, "member")} removed.` : "Nothing changed: everyone sent was already in that state.")
        : h("p", {}, h("span", { class: "badge badge--bad" }, step.result.exception), " ", step.result.message);
      const skipped = step.kind === "add" && step.result.ok ? step.sent.filter((n) => previous.includes(n)).length : 0;
      const ignored = step.kind === "remove" ? step.sent.filter((n) => !previous.includes(n)).length : 0;
      message.replaceChildren(...[
        h("p", { class: "seats__sent" }, h("code", {}, step.kind === "add" ? "add_users_to_team" : "remove_users_from_team"),
          ` with ${plural(step.count_sent, "id")}: ${shown}`),
        outcome,
        skipped ? h("p", { class: "note" }, `${plural(skipped, "of them was", "of them were")} already a member and skipped.`) : null,
        ignored ? h("p", { class: "note" }, `${plural(ignored, "of them was", "of them were")} not a member and ignored.`) : null,
        !step.result.ok && ghosts.length ? h("p", { class: "note" }, `The dashed ${ghosts.length === 1 ? "seat shows" : "seats show"} who would have been added. Because the request failed, none of them were.`) : null].filter(Boolean));
    },
  });
}
