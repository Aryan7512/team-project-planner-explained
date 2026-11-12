// Chapter 3: the five tables, read from the models and from SQLite.

import { h, sourceLink } from "../lib.js";

const AREA = { User: "user", TeamMembership: "member", Team: "team", Task: "task", Board: "board" };
const NS = "http://www.w3.org/2000/svg";

function fieldRow(field) {
  const badges = [];
  if (field.pk) badges.push(h("span", { class: "flag" }, "primary key"));
  if (field.unique) badges.push(h("span", { class: "flag" }, "unique"));
  if (field.null) badges.push(h("span", { class: "flag" }, "may be empty"));
  if (field.on_delete) badges.push(h("span", { class: `flag flag--${field.on_delete.toLowerCase()}` }, field.on_delete));
  const type = field.references ? `→ ${field.references}` : field.choices ? field.choices.join(" | ") : field.type;
  return h("li", { class: "field-row", "data-field": field.name },
    h("span", { class: "field-row__name" }, field.name),
    h("span", { class: "field-row__type" }, type),
    badges.length ? h("span", { class: "field-row__flags" }, badges) : null);
}

function tableCard(table) {
  const rules = table.constraints.map((c) => h("li", {},
    c.kind === "unique" ? [h("b", {}, "unique together "), c.fields.join(" + ")] : [h("b", {}, "check "), h("code", {}, c.sql)]));
  return h("section", { class: "table-card", "data-model": table.model, style: `grid-area: ${AREA[table.model]}` },
    h("header", { class: "table-card__head" },
      h("h3", {}, table.model),
      h("span", {}, table.table)),
    h("ul", { class: "field-rows" }, table.fields.map(fieldRow)),
    rules.length ? h("ul", { class: "table-card__rules" }, rules) : null);
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/* Routes for the six references, chosen for the fixed two-row layout. */
function route(model, field, rect) {
  const s = rect.row;           // the referencing field's row
  const t = rect.target;        // the referenced table's card
  const mid = (a, b) => (a + b) / 2;
  switch (`${model}.${field}`) {
    case "TeamMembership.user_id":
      return { d: [s.left, mid(s.top, s.bottom), s.left - 30, mid(s.top, s.bottom), t.right + 30, t.top + 22, t.right, t.top + 22] };
    case "TeamMembership.team_id":
      return { d: [s.right, mid(s.top, s.bottom), s.right + 30, mid(s.top, s.bottom), t.left - 30, t.top + 22, t.left, t.top + 22] };
    case "Team.admin_id": {
      const from = rect.card;
      const top = Math.min(from.top, t.top) - 46;
      return { d: [from.left + 36, from.top, from.left + 36, top, t.right - 36, top, t.right - 36, t.top] };
    }
    case "Task.board_id":
      return { d: [s.right, mid(s.top, s.bottom), s.right + 30, mid(s.top, s.bottom), t.left - 30, t.top + 22, t.left, t.top + 22] };
    case "Task.assignee_id":
      return { d: [s.left, mid(s.top, s.bottom), s.left - 26, mid(s.top, s.bottom), t.right + 26, t.bottom - 26, t.right, t.bottom - 26] };
    case "Board.team_id": {
      const out = Math.max(s.right, t.right) + 40;
      return { d: [s.right, mid(s.top, s.bottom), out, mid(s.top, s.bottom), out, t.bottom - 22, t.right, t.bottom - 22] };
    }
    default:
      return { d: [s.right, mid(s.top, s.bottom), s.right + 30, mid(s.top, s.bottom), t.left - 30, t.top + 22, t.left, t.top + 22] };
  }
}

function drawLinks(grid, svg, tables) {
  const box = grid.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.replaceChildren(svgEl("defs", {}));
  const marker = svgEl("marker", { id: "arrow", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
  marker.append(svgEl("path", { d: "M0 0 L8 4 L0 8 z", class: "link__head" }));
  svg.firstChild.append(marker);
  const local = (r) => ({ left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top });
  for (const table of tables) {
    const card = grid.querySelector(`[data-model="${table.model}"]`);
    for (const field of table.fields.filter((f) => f.references)) {
      const row = card.querySelector(`[data-field="${field.name}"]`);
      const target = grid.querySelector(`[data-model="${field.references}"] .table-card__head`);
      if (!row || !target) continue;
      const { d } = route(table.model, field.name, {
        row: local(row.getBoundingClientRect()),
        card: local(card.getBoundingClientRect()),
        target: local(target.closest(".table-card").getBoundingClientRect()),
      });
      const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = d;
      const path = svgEl("path", { d: `M${x0} ${y0} C${c1x} ${c1y} ${c2x} ${c2y} ${x1} ${y1}`, class: `link link--${field.on_delete.toLowerCase()}`, "marker-end": "url(#arrow)" });
      svg.append(path);
      const at = path.getPointAtLength(path.getTotalLength() / 2);
      const label = svgEl("text", { x: at.x, y: at.y - 5, class: "link__label", "text-anchor": "middle" });
      label.textContent = field.on_delete;
      svg.append(label);
    }
  }
}

export function renderSchema(root, schema) {
  const grid = h("div", { class: "schema__grid" });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "schema__links");
  svg.setAttribute("aria-hidden", "true");
  const only = schema.db_files.length === 1 && schema.db_files[0] === "planner.sqlite3";
  const file = h("section", { class: "table-card table-card--file", style: "grid-area: file" },
    h("header", { class: "table-card__head" }, h("h3", {}, "The file"), h("span", {}, "SQLite")),
    h("p", {}, h("code", {}, schema.db_file)),
    h("p", { class: "note" }, `${only ? "The only file the planner creates in db/. " : ""}It holds the five tables and their `
      + `${schema.index_count} indexes, including the ones behind every unique rule, plus `,
      schema.other_tables.flatMap((name, i) => [i ? " and " : "", h("code", {}, name)]),
      ", which Django and SQLite keep for their own bookkeeping."),
    h("p", { class: "note" }, "Its location is set once, in ", sourceLink(schema.settings, `planner_project/settings.py:${schema.settings.line}`), "."));
  grid.append(svg, ...schema.tables.map(tableCard), file);

  const sql = h("details", { class: "schema__sql" },
    h("summary", {}, "Show the CREATE TABLE statements as SQLite stores them"),
    schema.tables.map((t) => h("pre", { class: "code code--sql" }, t.create_sql)));
  root.replaceChildren(grid, sql);

  const redraw = () => drawLinks(grid, svg, schema.tables);
  new ResizeObserver(redraw).observe(grid);
  document.fonts?.ready.then(redraw);
}
