// Chapter 9: the test suite, the planted-bug check and the query counts.

import { h, plural } from "../lib.js";

const AREA = {
  test_teams: "Team APIs", test_validators: "Input checks", test_boards: "Board and task APIs", test_users: "User APIs",
  test_export: "Board export", test_models: "Database rules", test_web: "HTTP endpoints", test_performance: "Query counts",
  test_interfaces: "Matches the base classes", test_plain_script: "Plain script, separate processes",
};

export function renderQuality(root, data) {
  const caught = data.mutations.filter((m) => m.caught).length;
  const areas = Object.entries(data.per_module).sort((a, b) => b[1] - a[1]);
  const most = areas[0][1];

  const stats = h("dl", { class: "stats" },
    h("div", {}, h("dt", {}, "Tests"), h("dd", {}, String(data.tests)), h("p", {}, "all passing at this commit")),
    h("div", {}, h("dt", {}, "Python versions in CI"), h("dd", {}, data.ci_python.join(" and ")), h("p", {}, "on every push to GitHub")),
    h("div", {}, h("dt", {}, "Planted bugs caught"), h("dd", {}, `${caught} of ${data.mutations.length}`), h("p", {}, "each one made tests fail")));

  const bars = h("ol", { class: "bars" }, areas.map(([module, count]) => h("li", {},
    h("span", { class: "bars__label" }, AREA[module] || module),
    h("span", { class: "bars__track" }, h("span", { class: "bars__fill", style: `width: ${(count / most) * 100}%` })),
    h("span", { class: "bars__value" }, String(count)))));

  const mutations = h("table", { class: "data-table data-table--mutations" },
    h("thead", {}, h("tr", {}, ["Planted bug", "The change", "Tests that failed"].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, data.mutations.map((m) => h("tr", {},
      h("th", { scope: "row" }, m.title),
      h("td", {}, h("a", { href: m.url, class: "diff-link" }, `${m.file}:${m.line}`),
        h("pre", { class: "diff" },
          m.before.split("\n").map((line) => h("span", { class: "diff__del" }, `- ${line}\n`)),
          m.after.split("\n").map((line) => h("span", { class: "diff__add" }, `+ ${line}\n`)))),
      h("td", { class: "num" }, m.caught ? h("span", { class: "badge badge--ok" }, String(m.failing_tests)) : h("span", { class: "badge badge--bad" }, "none"))))));

  const queries = h("table", { class: "data-table" },
    h("thead", {}, h("tr", {}, ["API", "Amount of data", "Database queries"].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, data.query_counts.map((q) => h("tr", {},
      h("th", { scope: "row" }, h("code", {}, q.api)), h("td", {}, q.size), h("td", { class: "num" }, String(q.queries))))));

  root.replaceChildren(
    stats,
    h("section", { class: "quality__block" },
      h("h3", {}, "What the tests cover"),
      h("p", { class: "note" }, `Number of tests in each part of the suite, ${data.tests} in total.`),
      bars),
    h("section", { class: "quality__block" },
      h("h3", {}, "Do the tests notice a bug?"),
      h("p", { class: "note" }, `To find out, ${plural(data.mutations.length, "small, realistic bug")} were planted in a copy `
        + "of the code, one at a time, and the whole suite was run against each. A planted bug counts as caught when at least one "
        + "test fails."),
      h("div", { class: "table-scroll" }, mutations)),
    h("section", { class: "quality__block" },
      h("h3", {}, "Does it slow down as data grows?"),
      h("p", { class: "note" }, "Queries each call ran, counted while it ran. Lists cost one query, or two when the request "
        + "first looks up the record it names. Adding fifty users costs the same as adding one, and a board with forty tasks "
        + "exports in the same number of queries as a board with one."),
      h("div", { class: "table-scroll" }, queries)));
}
