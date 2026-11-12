// Chapter 1: the provided base classes and the methods to implement.

import { h } from "../lib.js";

export function renderClasses(container, brief) {
  container.replaceChildren(...brief.classes.map((cls) => h("section", { class: "class" },
    h("h3", { class: "class__name" }, cls.base),
    h("p", { class: "class__impl" }, "implemented by ", h("b", {}, cls.implementation)),
    h("ul", {}, cls.methods.map((method) => {
      const open = method.signature.indexOf("(");
      const marker = method.kind === "write" ? h("span", { class: "kind kind--write" }, "writes")
        : method.kind === "export" ? h("span", { class: "kind kind--export" }, "file") : null;
      return h("li", {}, h("a", { href: method.source.url, title: `Docstring of ${method.name} in ${method.source.file}` },
        h("span", { class: "sig" }, method.signature.slice(0, open), h("span", {}, method.signature.slice(open))), marker));
    })),
  )));
}
