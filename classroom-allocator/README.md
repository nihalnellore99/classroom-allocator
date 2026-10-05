# Classroom Allocator

Interactive companion app for the Foundation of AI PBL project **"Classroom Allocation using Backtracking"**.

Classroom allocation is modelled as a Constraint Satisfaction Problem (variables = courses, domains = rooms that fit by capacity and type, constraint = no room used twice in the same slot) and solved two ways:

1. **Plain backtracking**
2. **Backtracking + MRV + forward checking**

## What the app does

- **Solve**: edit rooms and courses (or keep the report's sample: 24 courses, 9 rooms, 4 slots), run either solver or both, see the timetable grid, node and backtrack counts, an independent verification, and download the timetable as CSV. The sample reproduces the report's numbers exactly: plain 138 nodes / 4 backtracks, MRV + FC 24 nodes / 0 backtracks.
- **Step replay**: watch either solver move by move (try, place, forward-check prune, dead end, backtrack) with a live timetable.
- **Benchmark**: scaling experiment on random solvable instances (24 to 42 courses) with a log-scale chart.
- **How it works**: the CSP formulation, pseudocode and the limitations discussed in the report.

No build step and no dependencies: plain HTML, CSS and JavaScript. Nothing is uploaded anywhere.

## Run it

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000     # then open http://localhost:8000
```

## Tests

```
node test.js
```

Checks the solvers against the report's sample numbers, the verifier, unsolvable cases, and that every generated benchmark instance is solved and verified.

## Publish on GitHub Pages (so a link opens the app)

1. Create a new **public** repository on GitHub, e.g. `classroom-allocator`.
2. Upload these files to the root of the repo (`index.html`, `style.css`, `app.js`, `solver.js`, `README.md`, `test.js`).
3. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`, then Save.
4. After about a minute the app is live at `https://<your-username>.github.io/classroom-allocator/`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and tabs |
| `style.css` | Styling (light and dark) |
| `solver.js` | Data, constraints, both solvers, verifier, instance generator |
| `app.js` | User interface |
| `test.js` | Node tests for the solvers |
