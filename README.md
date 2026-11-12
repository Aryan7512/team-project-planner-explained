# Team Project Planner, explained

An interactive, one-page walk through [Team Project Planner](https://github.com/Aryan7512/team-project-planner):
what happens inside the planner when you create a user, fill a team, close a board or export it, shown
with the real code's real output.

## How it stays accurate

Nothing on the page is typed by hand. `tools/capture.py` takes the planner's latest commit, runs the real
code in a temporary folder and records what happens into `data/*.json`: requests and responses, error
messages, the checks each request went through, SQL statements, source lines, test results, a planted-bug
check and a timing experiment. The page only replays those recordings and names the commit they came from.

The script also checks every claim the page's text makes, such as seat counts, query counts and every
planted bug being caught, and stops with an error if the planner ever behaves differently.

## Updating the recordings

```bash
python tools/capture.py ../team-project-planner
```

Use a Python that has the planner's requirements installed (Django 5.2). The planner repository must have
no uncommitted changes, so the page can cite an exact commit. A run takes about a minute.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. The page loads its data with `fetch`, so it needs a server rather than
opening `index.html` directly.

## Layout

```
index.html            the page and its text
assets/site.css       styles, light and dark
assets/site.js        loads the recordings and builds each chapter
assets/chapters/      one module per chapter
assets/lib.js         shared helpers
data/                 recordings written by tools/capture.py
tools/                the capture script
```

Plain HTML, CSS and JavaScript modules: no build step and no dependencies.
