// Team Project Planner, explained: loads the recorded data and builds each chapter.
// Every figure is drawn from data/*.json, recorded from the planner by tools/capture.py.

import { renderClasses } from "./chapters/brief.js";
import { renderBoard } from "./chapters/board.js";
import { renderDecisions } from "./chapters/decisions.js";
import { renderExport } from "./chapters/export.js";
import { renderHttp } from "./chapters/http.js";
import { setupPipeline } from "./chapters/pipeline.js";
import { renderQuality } from "./chapters/quality.js";
import { renderRace } from "./chapters/race.js";
import { renderSchema } from "./chapters/schema.js";
import { renderSeats } from "./chapters/seats.js";
import { h, load, storage } from "./lib.js";

function setupTheme() {
  const root = document.documentElement;
  const button = document.querySelector(".theme-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    const current = root.dataset.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    storage.set("theme", next);
  });
}

function renderFacts(meta) {
  const commit = document.querySelector('[data-fact="commit"]');
  if (commit) commit.replaceChildren(h("a", { href: meta.commit_url }, `commit ${meta.commit.slice(0, 7)}`), `, ${meta.captured_at.slice(0, 10)}`);
  const stack = document.querySelector('[data-fact="stack"]');
  if (stack) stack.textContent = `Django ${meta.django} with SQLite`;
  const tests = document.querySelector('[data-fact="tests"]');
  if (tests) tests.textContent = `${meta.tests.count} tests, all passing`;
  const footerLink = document.querySelector('[data-fact-link="commit"]');
  if (footerLink) { footerLink.href = meta.commit_url; footerLink.textContent = `commit ${meta.commit.slice(0, 7)}`; }
}

const CHAPTERS = [
  ["brief.json", "[data-classes]", (root, d) => renderClasses(root, d)],
  ["pipeline.json", "[data-pipeline]", (root, d) => { renderFacts(d.meta); setupPipeline(root, d); }],
  ["schema.json", "[data-schema]", (root, d) => renderSchema(root, d)],
  ["team.json", "[data-seats]", (root, d) => renderSeats(root, d)],
  ["board.json", "[data-board]", (root, d) => renderBoard(root, d)],
  ["race.json", "[data-race]", (root, d) => renderRace(root, d, document.querySelector("[data-race-setup]"), document.querySelector("[data-race-after]"))],
  ["export.json", "[data-export]", (root, d) => renderExport(root, d)],
  ["decisions.json", "[data-decisions]", (root, d) => renderDecisions(root, d, document.querySelector("[data-decisions-intro]"))],
  ["quality.json", "[data-quality]", (root, d) => renderQuality(root, d)],
  ["http.json", "[data-http]", (root, d) => renderHttp(root, d)],
];

async function main() {
  setupTheme();
  await Promise.all(CHAPTERS.map(async ([file, selector, render]) => {
    const root = document.querySelector(selector);
    if (!root) return;
    try {
      render(root, await load(`data/${file}`));
    } catch (error) {
      root.replaceChildren(h("p", { class: "loading" }, "This figure's recorded data could not be loaded."));
      console.error(file, error);
    }
  }));
}

main();
