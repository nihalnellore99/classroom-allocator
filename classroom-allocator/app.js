/* UI for the Classroom Allocator. Depends on solver.js (window.Solver). */
(function () {
  'use strict';
  const S = window.Solver;
  const $ = function (s, el) { return (el || document).querySelector(s); };
  const $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  const esc = function (v) {
    return String(v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  };
  const fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  const fmt1 = function (n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const TYPE_LABEL = { lecture: 'lecture', hall: 'hall', lab: 'lab' };
  const NODE_CAP = 5000000;

  const state = { rooms: S.clone(S.SAMPLE_ROOMS), courses: S.clone(S.SAMPLE_COURSES) };
  let last = null;            // last Solve result
  let showFrom = 'smart';     // which solver's allocation the grid displays
  const replay = { steps: [], idx: 0, timer: null, dirty: true, kind: 'smart', info: null };

  /* ================= tabs ================= */
  function showTab(name) {
    $$('.tab').forEach(function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
    if (name !== 'replay') stopPlay();
    if (name === 'replay' && replay.dirty) buildReplay();
  }
  $$('.tab').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  /* ================= editors ================= */
  function typeOptions(sel) {
    return ['lecture', 'hall', 'lab'].map(function (t) {
      return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>';
    }).join('');
  }

  function renderRooms() {
    $('#roomsTable tbody').innerHTML = state.rooms.map(function (r, i) {
      return '<tr data-i="' + i + '">' +
        '<td><input data-f="name" value="' + esc(r.name) + '" aria-label="Room name" autocomplete="off"></td>' +
        '<td><input data-f="capacity" type="number" min="1" inputmode="numeric" value="' + (Number.isFinite(r.capacity) ? r.capacity : '') + '" aria-label="Seats"></td>' +
        '<td><select data-f="type" aria-label="Room type">' + typeOptions(r.type) + '</select></td>' +
        '<td class="narrow"><button class="icon" type="button" data-del aria-label="Delete room ' + esc(r.name) + '">×</button></td></tr>';
    }).join('');
    $('#roomCount').textContent = state.rooms.length + ' rooms';
  }

  function renderCourses() {
    $('#coursesTable tbody').innerHTML = state.courses.map(function (c, i) {
      return '<tr data-i="' + i + '">' +
        '<td><input data-f="name" value="' + esc(c.name) + '" aria-label="Course name" autocomplete="off"></td>' +
        '<td><input data-f="students" type="number" min="1" inputmode="numeric" value="' + (Number.isFinite(c.students) ? c.students : '') + '" aria-label="Students"></td>' +
        '<td><select data-f="needs" aria-label="Room type needed">' + typeOptions(c.needs) + '</select></td>' +
        '<td><input data-f="slot" type="number" min="1" inputmode="numeric" value="' + (Number.isFinite(c.slot) ? c.slot : '') + '" aria-label="Time slot"></td>' +
        '<td class="narrow"><button class="icon" type="button" data-del aria-label="Delete course ' + esc(c.name) + '">×</button></td></tr>';
    }).join('');
    $('#courseCount').textContent = state.courses.length + ' courses';
  }

  function wireTable(tableSel, list, numericFields, rerender) {
    const tbody = $(tableSel + ' tbody');
    tbody.addEventListener('input', function (e) {
      const f = e.target.dataset.f;
      if (!f) return;
      const i = +e.target.closest('tr').dataset.i;
      const item = list()[i];
      item[f] = numericFields.indexOf(f) >= 0 ? parseInt(e.target.value, 10) : e.target.value.trim();
      markDirty();
    });
    tbody.addEventListener('click', function (e) {
      if (!e.target.closest('[data-del]')) return;
      const i = +e.target.closest('tr').dataset.i;
      list().splice(i, 1);
      rerender();
      markDirty();
    });
  }
  wireTable('#roomsTable', function () { return state.rooms; }, ['capacity'], renderRooms);
  wireTable('#coursesTable', function () { return state.courses; }, ['students', 'slot'], renderCourses);

  function uniqueName(prefix, list) {
    let n = list.length + 1;
    const taken = new Set(list.map(function (x) { return x.name; }));
    while (taken.has(prefix + n)) n++;
    return prefix + n;
  }
  function focusLast(tableSel) {
    const rows = $$(tableSel + ' tbody tr');
    const row = rows[rows.length - 1];
    if (!row) return;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    const inp = $('input', row);
    if (inp) { inp.focus(); inp.select(); }
  }
  $('#addRoom').addEventListener('click', function () {
    state.rooms.push({ name: uniqueName('R', state.rooms), capacity: 40, type: 'lecture' });
    renderRooms(); markDirty(); focusLast('#roomsTable');
  });
  $('#addCourse').addEventListener('click', function () {
    const slots = state.courses.map(function (c) { return c.slot; }).filter(Number.isFinite);
    state.courses.push({ name: uniqueName('NEW', state.courses), students: 30, needs: 'lecture', slot: slots.length ? slots[slots.length - 1] : 1 });
    renderCourses(); markDirty(); focusLast('#coursesTable');
  });
  $('#loadSample').addEventListener('click', function () {
    state.rooms = S.clone(S.SAMPLE_ROOMS);
    state.courses = S.clone(S.SAMPLE_COURSES);
    renderRooms(); renderCourses(); markDirty();
    $('#solveOut').innerHTML = '';
    last = null;
  });

  function markDirty() {
    replay.dirty = true;
    stopPlay();
    const stale = $('#staleNote');
    if (stale) stale.hidden = false;
  }

  /* ================= solve ================= */
  function errorCard(errs) {
    return '<div class="banner fail"><span class="mark">⚠</span><div><h3>Please fix the input first</h3><ul>' +
      errs.slice(0, 8).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') +
      (errs.length > 8 ? '<li>…and ' + (errs.length - 8) + ' more</li>' : '') + '</ul></div></div>';
  }

  function slotList(courses) {
    return Array.from(new Set(courses.map(function (c) { return c.slot; }))).sort(function (a, b) { return a - b; });
  }

  function solve() {
    const out = $('#solveOut');
    const errs = S.validate(state.rooms, state.courses);
    if (errs.length) { out.innerHTML = errorCard(errs); last = null; return; }

    const rooms = S.clone(state.rooms), courses = S.clone(state.courses);
    const mode = $('input[name=mode]:checked').value;
    const runs = {};
    if (mode !== 'smart') runs.plain = S.solvePlain(rooms, courses, { maxNodes: NODE_CAP });
    if (mode !== 'plain') runs.smart = S.solveSmart(rooms, courses, { maxNodes: NODE_CAP });

    const domains = S.buildDomains(rooms, courses);
    last = { rooms: rooms, courses: courses, runs: runs, domains: domains };
    showFrom = runs.smart ? 'smart' : 'plain';
    renderResults();
  }

  function whyNoSolution(rooms, courses, domains) {
    const reasons = [];
    courses.forEach(function (c) {
      if (domains[c.name].length === 0) {
        reasons.push('<b>' + esc(c.name) + '</b> (' + c.students + ' students, needs ' + c.needs + ') has no suitable room at all.');
      }
    });
    slotList(courses).forEach(function (s) {
      const inSlot = courses.filter(function (c) { return c.slot === s; });
      if (inSlot.length > rooms.length) {
        reasons.push('Slot ' + s + ' has ' + inSlot.length + ' courses but only ' + rooms.length + ' rooms exist.');
      } else {
        // pigeonhole check per room type group: courses that can only use lab rooms, etc.
        ['lab', 'hall'].forEach(function (t) {
          const only = inSlot.filter(function (c) { return c.needs === t; });
          const roomsOfType = rooms.filter(function (r) { return r.type === t; });
          if (only.length > roomsOfType.length) {
            reasons.push('Slot ' + s + ' has ' + only.length + ' ' + t + ' courses but only ' + roomsOfType.length + ' ' + t + ' room' + (roomsOfType.length === 1 ? '' : 's') + '.');
          }
        });
      }
    });
    return reasons;
  }

  function statCard(kind, label, r) {
    const approx = r.aborted ? '≥ ' : '';
    return '<div class="stat ' + kind + '"><h3><span>' + label + '</span><span class="muted small">' +
      (r.aborted ? 'stopped at cap' : (r.solved ? 'solved' : 'no solution')) + '</span></h3>' +
      '<div class="num">' + approx + fmt(r.nodes) + ' <span class="muted small">nodes</span></div>' +
      '<dl><div><dt>Backtracks</dt><dd>' + approx + fmt(r.backtracks) + '</dd></div>' +
      '<div><dt>Time</dt><dd>' + (r.ms < 1 ? '<1' : fmt1(r.ms, r.ms < 10 ? 2 : 0)) + ' ms</dd></div>' +
      '<div><dt>Result</dt><dd>' + (r.solved ? 'valid' : (r.aborted ? 'unknown' : 'none')) + '</dd></div></dl></div>';
  }

  function renderResults() {
    if (!last) return;
    const out = $('#solveOut');
    const rooms = last.rooms, courses = last.courses, runs = last.runs;
    const primary = runs.smart || runs.plain;
    const parts = [];

    // --- banner ---
    if (primary.solved) {
      const v = S.verify(rooms, courses, primary.assignment);
      parts.push(v.ok
        ? '<div class="banner ok"><span class="mark">✓</span><div><h3>Valid timetable found</h3><p>Checked independently: all ' + courses.length +
          ' courses have a room that is big enough and the right type, and no room is double-booked in any slot.</p></div></div>'
        : '<div class="banner fail"><span class="mark">⚠</span><div><h3>Solver output failed verification</h3><ul>' +
          v.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div></div>');
    } else if (primary.aborted) {
      parts.push('<div class="banner warn"><span class="mark">⏱</span><div><h3>Search stopped after ' + fmt(NODE_CAP) + ' nodes</h3><p>That is the safety cap on this page. The instance may still be solvable; try the MRV + forward checking solver.</p></div></div>');
    } else {
      const reasons = whyNoSolution(rooms, courses, last.domains);
      parts.push('<div class="banner fail"><span class="mark">✗</span><div><h3>No valid allocation exists</h3>' +
        '<p>The search tried every possibility and ran out of options.</p>' +
        (reasons.length ? '<ul>' + reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' : '') + '</div></div>');
    }

    // --- stats ---
    let stats = '<div class="stats">';
    if (runs.plain) stats += statCard('plain', 'Plain backtracking', runs.plain);
    if (runs.smart) stats += statCard('smart', 'MRV + forward checking', runs.smart);
    stats += '</div>';
    parts.push(stats);

    if (runs.plain && runs.smart && runs.plain.nodes > 0 && runs.smart.nodes > 0 && !runs.plain.aborted && !runs.smart.aborted) {
      const ratio = runs.plain.nodes / runs.smart.nodes;
      let line;
      if (ratio > 1.05) line = 'MRV + forward checking explored <b>' + fmt1(ratio, 1) + '×</b> fewer nodes (' + fmt(runs.smart.nodes) + ' vs ' + fmt(runs.plain.nodes) + ').';
      else if (ratio < 0.95) line = 'On this instance plain backtracking explored fewer nodes (' + fmt(runs.plain.nodes) + ' vs ' + fmt(runs.smart.nodes) + '). The heuristics pay off on harder, tighter instances; see the Benchmark tab.';
      else line = 'Both solvers explored about the same number of nodes here.';
      parts.push('<p class="verdict">' + line + '</p>');
    }

    // --- timetable ---
    const shown = runs[showFrom] && runs[showFrom].solved ? runs[showFrom] : (primary.solved ? primary : null);
    if (shown) {
      const both = runs.plain && runs.smart && runs.plain.solved && runs.smart.solved;
      let head = '<div class="result-head"><h2>Timetable</h2><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">';
      if (both) {
        head += '<div class="seg" role="radiogroup" aria-label="Show allocation from">' +
          '<label><input type="radio" name="showFrom" value="smart"' + (showFrom === 'smart' ? ' checked' : '') + '><span>MRV + FC</span></label>' +
          '<label><input type="radio" name="showFrom" value="plain"' + (showFrom === 'plain' ? ' checked' : '') + '><span>Plain</span></label></div>';
      }
      head += '<button class="dl-btn" type="button" id="csvBtn">Download CSV</button></div></div>';

      let unused = 0;
      const rby = {};
      rooms.forEach(function (r) { rby[r.name] = r; });
      courses.forEach(function (c) { unused += rby[shown.assignment[c.name]].capacity - c.students; });

      parts.push('<div class="card">' + head +
        '<div class="scroll">' + renderGrid(rooms, courses, shown.assignment) + '</div>' +
        '<p class="muted small" style="margin:10px 0 0">Bar inside each cell = seats filled. Total empty seats across booked rooms: <b>' + fmt(unused) +
        '</b> (the solver returns the first valid allocation, it does not try to minimise this).</p></div>');
    }

    // --- domains ---
    const domRows = courses.map(function (c) {
      const d = last.domains[c.name];
      const cls = d.length === 0 ? 'none' : (d.length === 1 ? 'tight' : '');
      return '<tr class="' + cls + '"><td>' + esc(c.name) + '</td><td>' + c.students + ' · ' + c.needs + ' · slot ' + c.slot + '</td><td>' +
        (d.length ? d.map(function (r) { return '<span class="dom-chip' + (d.length === 1 ? ' hi' : '') + '">' + esc(r) + '</span>'; }).join('') : '<span class="muted">none</span>') +
        '</td><td>' + d.length + '</td></tr>';
    }).join('');
    parts.push('<details class="card"><summary>Domains after the capacity and type constraints (what MRV looks at)</summary><div class="scroll limit"><table class="data left">' +
      '<thead><tr><th>Course</th><th>Needs</th><th>Legal rooms</th><th>Size</th></tr></thead><tbody>' + domRows + '</tbody></table></div>' +
      '<p class="muted small">Courses with a single legal room are highlighted: MRV places these first, and forward checking then removes that room from everything else in the slot.</p></details>');

    out.innerHTML = '<p id="staleNote" class="muted small" hidden>The inputs changed after this result. Press Solve to refresh.</p><div class="out-stack">' + parts.join('') + '</div>';

    $$('input[name=showFrom]').forEach(function (el) {
      el.addEventListener('change', function () { showFrom = el.value; renderResults(); });
    });
    const csv = $('#csvBtn');
    if (csv) csv.addEventListener('click', function () { downloadCsv(rooms, courses, shown.assignment); });
  }

  /* ---------- timetable grid (used by Solve and Replay) ---------- */
  function renderGrid(rooms, courses, assignment, opts) {
    opts = opts || {};
    const slots = slotList(courses);
    const rby = {};
    rooms.forEach(function (r) { rby[r.name] = r; });
    const cell = {};
    courses.forEach(function (c) {
      const rn = assignment[c.name];
      if (rn) cell[c.slot + '|' + rn] = c;
    });
    let h = '<table class="tt"><thead><tr><th>Room</th>' + slots.map(function (s) { return '<th>Slot ' + s + '</th>'; }).join('') + '</tr></thead><tbody>';
    rooms.forEach(function (r) {
      const probe = opts.probeRoom === r.name ? ' probe' + (opts.probeBad ? ' bad' : '') : '';
      h += '<tr class="' + probe.trim() + '"><td><span class="room-name">' + esc(r.name) + '</span><span class="chip ' + r.type + '">' + r.type + '</span><span class="room-cap">' + r.capacity + ' seats</span></td>';
      slots.forEach(function (s) {
        const c = cell[s + '|' + r.name];
        if (c) {
          const pct = Math.min(100, Math.round(100 * c.students / r.capacity));
          const isNew = opts.newCourse === c.name ? ' new' : '';
          h += '<td><div class="cell ' + r.type + isNew + '"><b>' + esc(c.name) + '</b><span>' + c.students + '/' + r.capacity + '</span><i style="width:' + pct + '%"></i></div></td>';
        } else {
          h += '<td><span class="empty">·</span></td>';
        }
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  function downloadCsv(rooms, courses, assignment) {
    const rby = {};
    rooms.forEach(function (r) { rby[r.name] = r; });
    const q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['Slot', 'Course', 'Students', 'Needs', 'Room', 'Seats', 'RoomType']];
    courses.slice().sort(function (a, b) { return a.slot - b.slot; }).forEach(function (c) {
      const r = rby[assignment[c.name]];
      rows.push([c.slot, c.name, c.students, c.needs, r.name, r.capacity, r.type]);
    });
    const blob = new Blob([rows.map(function (r) { return r.map(q).join(','); }).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'timetable.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  $('#solveBtn').addEventListener('click', solve);

  /* ================= step replay ================= */
  function stopPlay() {
    if (replay.timer) { clearInterval(replay.timer); replay.timer = null; }
    const b = $('#rpPlay');
    if (b) b.textContent = '▶';
  }

  function buildReplay() {
    stopPlay();
    const log = $('#rpLog');
    const errs = S.validate(state.rooms, state.courses);
    if (errs.length) {
      replay.steps = []; replay.info = null;
      log.innerHTML = '<li class="now bad">' + esc(errs[0]) + '</li>';
      $('#rpGrid').innerHTML = '';
      $('#rpSlider').max = 0; $('#rpSlider').value = 0;
      $('#rpStep').textContent = 'Fix the input on the Solve tab first';
      $('#rpCounters').textContent = '';
      return;
    }
    const rooms = S.clone(state.rooms), courses = S.clone(state.courses);
    replay.kind = $('#replaySolver').value;
    const trace = [];
    const res = replay.kind === 'plain'
      ? S.solvePlain(rooms, courses, { trace: trace, maxNodes: NODE_CAP })
      : S.solveSmart(rooms, courses, { trace: trace, maxNodes: NODE_CAP });
    replay.steps = trace;
    replay.info = { rooms: rooms, courses: courses, res: res };
    replay.idx = 0;
    replay.dirty = false;
    $('#rpSlider').max = trace.length;
    $('#rpSlider').value = 0;
    const notes = [];
    if (res.truncated) notes.push('The replay shows only the first ' + fmt(trace.length) + ' steps of a longer search.');
    if (res.aborted) notes.push('Search hit the ' + fmt(NODE_CAP) + '-node cap.');
    if (!res.solved && !res.aborted && !res.truncated) notes.push('This instance has no valid allocation; the replay ends in failure.');
    $('#rpNote').textContent = notes.join(' ');
    renderReplay();
  }

  function stepText(ev, kind, courseBy) {
    const c = function (n) { return '<code>' + esc(n) + '</code>'; };
    if (ev.k === 'pick') {
      return '<span class="tag">pick</span>Next course: ' + c(ev.c) + ' — fewest legal rooms left (' + ev.d + ')';
    }
    if (ev.k === 'undo') {
      return '<span class="tag">backtrack</span>Take ' + c(ev.c) + ' out of ' + c(ev.r) + (kind === 'smart' ? ' and restore the pruned domains' : '');
    }
    if (ev.res === 'fit') return '<span class="tag">try</span>' + c(ev.c) + ' → ' + c(ev.r) + ' — ✗ too small or wrong type';
    if (ev.res === 'clash') return '<span class="tag">try</span>' + c(ev.c) + ' → ' + c(ev.r) + ' — ✗ already booked in slot ' + courseBy[ev.c].slot;
    if (ev.res === 'wipe') return '<span class="tag">try</span>' + c(ev.c) + ' → ' + c(ev.r) + ' — ✗ forward check empties the domain of ' + c(ev.wiped) + ' (dead end)';
    let t = '<span class="tag">place</span>' + c(ev.c) + ' → ' + c(ev.r) + ' ✓';
    if (kind === 'smart') {
      t += ev.pruned && ev.pruned.length
        ? ' — forward check removes ' + c(ev.r) + ' from ' + ev.pruned.map(c).join(', ')
        : ' — nobody else in the slot was using that room as an option';
    }
    return t;
  }
  function stepClass(ev) {
    if (ev.k === 'undo') return 'bad';
    if (ev.k === 'try') return ev.res === 'ok' ? 'good' : 'bad';
    return '';
  }

  function renderReplay() {
    if (!replay.info) return;
    const rooms = replay.info.rooms, courses = replay.info.courses;
    const courseBy = {};
    courses.forEach(function (c) { courseBy[c.name] = c; });
    const steps = replay.steps, idx = replay.idx;

    // rebuild partial assignment + counters from the first idx events
    const assign = {};
    let nodes = 0, backs = 0;
    for (let i = 0; i < idx; i++) {
      const ev = steps[i];
      if (ev.k === 'try') { nodes++; if (ev.res === 'ok') assign[ev.c] = ev.r; }
      else if (ev.k === 'undo') { backs++; delete assign[ev.c]; }
    }
    const cur = idx > 0 ? steps[idx - 1] : null;

    $('#rpStep').textContent = 'Step ' + fmt(idx) + ' / ' + fmt(steps.length);
    $('#rpCounters').textContent = fmt(nodes) + ' nodes · ' + fmt(backs) + ' backtracks · ' + Object.keys(assign).length + '/' + courses.length + ' placed';
    $('#rpSlider').value = idx;

    // log window
    const from = Math.max(0, idx - 6), to = Math.min(steps.length, idx + 14);
    let h = '';
    if (idx === 0) h += '<li class="now">Press ▶ to start, or step through one move at a time.</li>';
    for (let i = from; i < to; i++) {
      const cls = i === idx - 1 ? 'now ' + stepClass(steps[i]) : (i < idx ? 'past' : '');
      h += '<li class="' + cls + '">' + stepText(steps[i], replay.kind, courseBy) + '</li>';
    }
    if (idx >= steps.length && steps.length) {
      const r = replay.info.res;
      h += '<li class="now ' + (r.solved ? 'good' : 'bad') + '">' + (r.solved ? '✓ Complete allocation found' : (r.aborted ? 'Stopped at the node cap' : '✗ No valid allocation exists')) + '</li>';
    }
    $('#rpLog').innerHTML = h;

    const opts = {};
    if (cur && cur.k === 'try') {
      opts.probeRoom = cur.r;
      opts.probeBad = cur.res !== 'ok';
      if (cur.res === 'ok') opts.newCourse = cur.c;
    } else if (cur && cur.k === 'undo') {
      opts.probeRoom = cur.r; opts.probeBad = true;
    }
    $('#rpGrid').innerHTML = renderGrid(rooms, courses, assign, opts);
  }

  function setIdx(i) {
    replay.idx = Math.max(0, Math.min(replay.steps.length, i));
    renderReplay();
  }
  function togglePlay() {
    if (replay.timer) { stopPlay(); return; }
    if (!replay.steps.length) return;
    if (replay.idx >= replay.steps.length) replay.idx = 0;
    $('#rpPlay').textContent = '❚❚';
    replay.timer = setInterval(function () {
      if (replay.idx >= replay.steps.length) { stopPlay(); return; }
      setIdx(replay.idx + 1);
    }, +$('#rpSpeed').value);
  }
  $('#rpStart').addEventListener('click', function () { stopPlay(); setIdx(0); });
  $('#rpPrev').addEventListener('click', function () { stopPlay(); setIdx(replay.idx - 1); });
  $('#rpNext').addEventListener('click', function () { stopPlay(); setIdx(replay.idx + 1); });
  $('#rpEnd').addEventListener('click', function () { stopPlay(); setIdx(replay.steps.length); });
  $('#rpPlay').addEventListener('click', togglePlay);
  $('#rpSlider').addEventListener('input', function (e) { stopPlay(); setIdx(+e.target.value); });
  $('#rpSpeed').addEventListener('change', function () { if (replay.timer) { stopPlay(); togglePlay(); } });
  $('#replaySolver').addEventListener('change', buildReplay);

  /* ================= benchmark ================= */
  const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  async function runBench() {
    const sizes = $$('input[name=size]:checked').map(function (x) { return +x.value; }).sort(function (a, b) { return a - b; });
    const N = Math.max(1, Math.min(100, parseInt($('#bnN').value, 10) || 20));
    const seed = parseInt($('#bnSeed').value, 10) || 0;
    const status = $('#bnStatus');
    if (!sizes.length) { status.textContent = 'Pick at least one problem size.'; return; }

    const btn = $('#bnRun'), bar = $('#bnProgress');
    btn.disabled = true; bar.hidden = false;
    const total = sizes.length * N;
    let done = 0;
    const rows = [];

    for (let s = 0; s < sizes.length; s++) {
      const n = sizes[s];
      const agg = { n: n, pN: 0, pB: 0, pT: 0, sN: 0, sB: 0, sT: 0, verified: 0, capped: 0, solvedS: 0 };
      for (let i = 0; i < N; i++) {
        const inst = S.generateInstance(n, seed + n * 100 + i, 3);
        const a = S.solvePlain(inst.rooms, inst.courses, { maxNodes: NODE_CAP });
        const b = S.solveSmart(inst.rooms, inst.courses);
        agg.pN += a.nodes; agg.pB += a.backtracks; agg.pT += a.ms;
        agg.sN += b.nodes; agg.sB += b.backtracks; agg.sT += b.ms;
        if (a.aborted) agg.capped++;
        if (b.solved) agg.solvedS++;
        const okS = b.solved && S.verify(inst.rooms, inst.courses, b.assignment).ok;
        const okP = a.aborted || (a.solved && S.verify(inst.rooms, inst.courses, a.assignment).ok);
        if (okS && okP) agg.verified++;
        done++;
        bar.firstElementChild.style.width = Math.round(100 * done / total) + '%';
        status.textContent = 'Running… ' + done + ' / ' + total + ' instances (' + n + ' courses)';
        await tick();
      }
      agg.N = N;
      rows.push(agg);
    }
    btn.disabled = false;
    bar.hidden = true;
    bar.firstElementChild.style.width = '0';
    status.textContent = 'Done: ' + total + ' instances, seed ' + seed + '.';
    renderBench(rows, N);
  }

  function renderBench(rows, N) {
    const anyCap = rows.some(function (r) { return r.capped > 0; });
    const body = rows.map(function (r) {
      const ge = r.capped ? '≥ ' : '';
      return '<tr><td>' + r.n + '</td><td>' + ge + fmt(r.pN / r.N) + '</td><td>' + ge + fmt(r.pB / r.N) + '</td><td>' + ge + fmt1(r.pT / r.N, 2) + '</td>' +
        '<td>' + fmt1(r.sN / r.N, 2) + '</td><td>' + fmt1(r.sB / r.N, 2) + '</td><td>' + fmt1(r.sT / r.N, 2) + '</td>' +
        '<td>' + r.verified + ' / ' + r.N + '</td></tr>';
    }).join('');

    const last = rows[rows.length - 1];
    const ratio = last.sN > 0 ? last.pN / last.sN : 0;
    const summary = '<p class="verdict">At ' + last.n + ' courses the plain solver averaged <b>' + (last.capped ? '≥ ' : '') + fmt(last.pN / last.N) +
      '</b> nodes; MRV + forward checking averaged <b>' + fmt1(last.sN / last.N, 1) + '</b> (about ' + (last.capped ? '≥ ' : '') + fmt(ratio) + '× fewer).</p>';

    $('#bnOut').innerHTML = '<div class="card out-stack">' +
      '<h2>Results (average per instance, ' + N + ' per size)</h2>' + summary +
      '<div class="scroll"><table class="data"><thead><tr><th>Courses</th><th>Plain nodes</th><th>Plain backtracks</th><th>Plain ms</th>' +
      '<th>MRV+FC nodes</th><th>MRV+FC backtracks</th><th>MRV+FC ms</th><th>Verified</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      (anyCap ? '<p class="muted small">"≥" means at least one plain-solver run hit the ' + fmt(NODE_CAP) + '-node cap, so that average is a lower bound.</p>' : '') +
      '<div><div class="legend"><span><i style="background:var(--plain)"></i>Plain backtracking</span><span><i style="background:var(--smart)"></i>Backtracking + MRV + forward checking</span></div>' +
      lineChart(rows) + '</div>' +
      '<p class="muted small">Plain search effort is heavy-tailed: many instances are easy and a few are very hard, so the average grows fast while the median stays modest. MRV + forward checking is steady because the most constrained course is always placed first.</p></div>';
  }

  function lineChart(rows) {
    const W = 640, H = 320, m = { l: 62, r: 20, t: 14, b: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = [];
    rows.forEach(function (r) { vals.push(Math.max(1, r.pN / r.N), Math.max(1, r.sN / r.N)); });
    const maxV = Math.max.apply(null, vals);
    const top = Math.max(2, Math.ceil(Math.log10(maxV * 1.05)));
    const y = function (v) { return m.t + ih - (Math.log10(Math.max(1, v)) / top) * ih; };
    const x = function (i) { return rows.length === 1 ? m.l + iw / 2 : m.l + (iw * i) / (rows.length - 1); };
    let g = '';
    for (let p = 0; p <= top; p++) {
      const yy = m.t + ih - (p / top) * ih;
      g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (yy + 4) + '" text-anchor="end">10' + sup(p) + '</text>';
    }
    rows.forEach(function (r, i) {
      g += '<text x="' + x(i) + '" y="' + (H - m.b + 18) + '" text-anchor="middle">' + r.n + '</text>';
    });
    const line = function (cls, key) {
      const pts = rows.map(function (r, i) { return x(i) + ',' + y(r[key] / r.N); }).join(' ');
      return '<polyline class="ln-' + cls + '" points="' + pts + '"/>' +
        rows.map(function (r, i) { return '<circle class="pt-' + cls + '" cx="' + x(i) + '" cy="' + y(r[key] / r.N) + '" r="4"/>'; }).join('');
    };
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average nodes explored versus number of courses, log scale">' +
      g + line('plain', 'pN') + line('smart', 'sN') +
      '<text class="axis-title" x="' + (m.l + iw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">Number of courses (3 slots)</text>' +
      '<text class="axis-title" transform="translate(14 ' + (m.t + ih / 2) + ') rotate(-90)" text-anchor="middle">Nodes explored (log scale)</text></svg>';
  }
  function sup(n) { return String(n).split('').map(function (d) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]; }).join(''); }

  $('#bnRun').addEventListener('click', runBench);

  /* ================= init ================= */
  renderRooms();
  renderCourses();
  solve();   // show the report's sample result straight away
})();
