// Chapter 7: a real export, with its parts labelled.

import { h } from "../lib.js";

export function renderExport(root, data) {
  const lines = data.text.replace(/\n$/, "").split("\n");
  const rows = lines.map((line, n) => h("span", { class: "file__line", "data-line": String(n) },
    h("span", { class: "file__number", "aria-hidden": "true" }, String(n + 1)), h("span", { class: "file__text" }, line || " ")));
  const file = h("pre", { class: "file", tabindex: "0", "aria-label": `Contents of ${data.out_file}` }, rows);

  const parts = data.parts.map((part, i) => h("li", {},
    h("button", { type: "button", class: "part", "aria-pressed": "false", "data-part": String(i) },
      h("span", { class: "part__title" }, part.title),
      h("span", { class: "part__lines" }, `lines ${part.start + 1}–${part.end + 1}`),
      h("span", { class: "part__text" }, part.text))));

  function highlight(index) {
    const part = data.parts[index];
    root.querySelectorAll(".part").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.part) === index)));
    rows.forEach((row, n) => row.classList.toggle("is-lit", part && n >= part.start && n <= part.end));
    if (part) rows[part.start].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  root.addEventListener("click", (event) => {
    const button = event.target.closest(".part");
    if (!button) return;
    const index = Number(button.dataset.part);
    highlight(button.getAttribute("aria-pressed") === "true" ? -1 : index);
  });

  root.replaceChildren(
    h("div", { class: "export" },
      h("div", { class: "export__file" },
        h("div", { class: "export__name" }, h("span", { class: "label" }, "out/"), h("code", {}, data.out_file),
          h("span", { class: "export__size" }, `${data.bytes.toLocaleString("en")} bytes`)),
        file),
      h("div", { class: "export__side" },
        h("p", { class: "label" }, "Parts of the file"),
        h("ol", { class: "parts" }, parts),
        h("div", { class: "export__facts" },
          h("p", {}, h("b", {}, "Never overwritten. "),
            data.second_out_file === data.out_file.replace(/\.txt$/, "-2.txt")
              ? "Exporting the same board again in the same second returned "
              : "Exporting the same board again returned ",
            h("code", {}, data.second_out_file), ". The first file was left exactly as it was."),
          h("p", {}, h("b", {}, "Cleaned text. "), "One task's description was stored with a line break in it:"),
          h("pre", { class: "code" }, JSON.stringify(data.cleaned.description)),
          h("p", {}, "In the file it reads ", h("q", {}, data.cleaned.shown), ", on one line.")))),
    h("figcaption", {}, "A real export of board Sprint 2, shown exactly as written. Select a part to see where it is in the file."));
}
