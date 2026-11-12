// Chapter 8: every assumption from the README, with the line of the brief that prompted it.

import { h, inlineCode, sourceLink } from "../lib.js";

export function renderDecisions(root, data, intro) {
  if (intro) intro.replaceChildren(...inlineCode(data.intro));
  root.replaceChildren(
    ...data.groups.map((group) => h("section", { class: "decision-group" },
      h("h3", {}, group.title, h("span", {}, String(group.decisions.length))),
      h("ol", { class: "decision-list" }, group.decisions.map((d) => h("li", { class: "decision" },
        h("div", { class: "decision__main" },
          h("p", { class: "decision__what" }, inlineCode(d.decision)),
          h("p", { class: "decision__why" }, h("span", { class: "label" }, "Why"), " ", inlineCode(d.why))),
        d.evidence.length
          ? h("div", { class: "decision__source" },
            h("p", { class: "label" }, "From the brief"),
            d.evidence.map((e) => h("blockquote", {},
              h("code", {}, e.quote),
              h("cite", {}, sourceLink(e, `${e.file}:${e.line}`)))))
          : null))))),
    h("p", { class: "decisions__more" }, "The same list, as the README states it: ",
      h("a", { href: data.readme_url }, "README.md, Assumptions"), "."));
}
