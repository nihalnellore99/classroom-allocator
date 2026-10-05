/* Classroom allocation as a CSP — solvers, verifier and instance generator.
 * Direct port of allocator.py from the PBL report (Appendix A), extended with
 * optional step traces (for the replay tab) and a node cap (for the benchmark).
 * Works in the browser (window.Solver) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  /* ---------- Sample data (Sections 6.1 and 6.2 of the report) ---------- */
  const SAMPLE_ROOMS = [
    { name: 'A101', capacity: 40, type: 'lecture' },
    { name: 'A102', capacity: 40, type: 'lecture' },
    { name: 'A201', capacity: 60, type: 'lecture' },
    { name: 'A202', capacity: 60, type: 'lecture' },
    { name: 'B101', capacity: 120, type: 'hall' },
    { name: 'B102', capacity: 90, type: 'hall' },
    { name: 'LAB1', capacity: 30, type: 'lab' },
    { name: 'LAB2', capacity: 30, type: 'lab' },
    { name: 'LAB3', capacity: 45, type: 'lab' },
  ];

  const SAMPLE_COURSES = [
    ['CS101', 55, 'lecture', 1], ['CS201', 38, 'lecture', 1], ['CS301', 85, 'hall', 1],
    ['CS102L', 28, 'lab', 1], ['MA101', 110, 'hall', 1], ['PH101', 58, 'lecture', 1],
    ['EC201', 60, 'lecture', 2], ['EC202', 36, 'lecture', 2], ['CS302', 88, 'hall', 2],
    ['CS103L', 30, 'lab', 2], ['CS104L', 42, 'lab', 2], ['ME101', 39, 'lecture', 2],
    ['MA201', 59, 'lecture', 3], ['CS401', 40, 'lecture', 3], ['HS101', 100, 'hall', 3],
    ['EC203L', 27, 'lab', 3], ['CS105L', 44, 'lab', 3], ['PH102', 35, 'lecture', 3],
    ['CS501', 57, 'lecture', 4], ['CS502', 37, 'lecture', 4], ['MA301', 92, 'hall', 4],
    ['CS106L', 29, 'lab', 4], ['EC301', 60, 'lecture', 4], ['ME201', 40, 'lecture', 4],
  ].map(function (c) { return { name: c[0], students: c[1], needs: c[2], slot: c[3] }; });

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* ---------- Constraints ---------- */
  // Unary: capacity + type. Lectures may use a lecture room or a hall.
  function compatible(course, room) {
    if (course.needs === 'lecture') {
      return (room.type === 'lecture' || room.type === 'hall') && room.capacity >= course.students;
    }
    return room.type === course.needs && room.capacity >= course.students;
  }

  // Binary: same slot + same room is a clash.
  function conflict(c1, r1, c2, r2) {
    return c1.slot === c2.slot && r1 === r2;
  }

  /* ---------- Input validation ---------- */
  function validate(rooms, courses) {
    const errors = [];
    const seenR = new Set(), seenC = new Set();
    const types = ['lecture', 'hall', 'lab'];
    rooms.forEach(function (r, i) {
      if (!r.name || !String(r.name).trim()) errors.push('Room ' + (i + 1) + ' has no name.');
      else if (seenR.has(r.name)) errors.push('Duplicate room name: ' + r.name);
      seenR.add(r.name);
      if (!(Number.isInteger(r.capacity) && r.capacity > 0)) errors.push('Room ' + r.name + ': capacity must be a positive whole number.');
      if (types.indexOf(r.type) < 0) errors.push('Room ' + r.name + ': unknown type.');
    });
    courses.forEach(function (c, i) {
      if (!c.name || !String(c.name).trim()) errors.push('Course ' + (i + 1) + ' has no name.');
      else if (seenC.has(c.name)) errors.push('Duplicate course name: ' + c.name);
      seenC.add(c.name);
      if (!(Number.isInteger(c.students) && c.students > 0)) errors.push('Course ' + c.name + ': students must be a positive whole number.');
      if (!(Number.isInteger(c.slot) && c.slot > 0)) errors.push('Course ' + c.name + ': slot must be a positive whole number.');
      if (types.indexOf(c.needs) < 0) errors.push('Course ' + c.name + ': unknown room type needed.');
    });
    if (!rooms.length) errors.push('Add at least one room.');
    if (!courses.length) errors.push('Add at least one course.');
    return errors;
  }

  /* ---------- Domains (unary constraints applied up front) ---------- */
  function buildDomains(rooms, courses) {
    const d = {};
    courses.forEach(function (c) {
      d[c.name] = rooms.filter(function (r) { return compatible(c, r); }).map(function (r) { return r.name; });
    });
    return d;
  }

  /* ---------- Plain backtracking ----------
   * Fixed order (by slot, ordinary lectures before labs/halls); constraints are
   * checked only when a room is assigned.  `nodes` counts every room tried.
   */
  function solvePlain(rooms, courses, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || Infinity;
    const trace = opts.trace || null;
    const traceLimit = opts.traceLimit || 20000;

    const order = courses.slice().sort(function (a, b) {
      if (a.slot !== b.slot) return a.slot - b.slot;
      return (a.needs !== 'lecture' ? 1 : 0) - (b.needs !== 'lecture' ? 1 : 0);
    });
    const n = order.length;
    const compat = order.map(function (c) { return rooms.map(function (r) { return compatible(c, r); }); });
    const used = {}; // slot -> Uint8Array(rooms)
    order.forEach(function (c) { if (!used[c.slot]) used[c.slot] = new Uint8Array(rooms.length); });

    const st = { nodes: 0, backtracks: 0, aborted: false, truncated: false };
    const pick = new Array(n).fill(-1);

    function emit(ev) {
      if (!trace) return;
      if (trace.length >= traceLimit) { st.truncated = true; return; }
      trace.push(ev);
    }

    function rec(i) {
      if (i === n) return true;
      const c = order[i];
      for (let ri = 0; ri < rooms.length; ri++) {
        st.nodes++;
        if (st.nodes > maxNodes) { st.aborted = true; return false; }
        if (!compat[i][ri]) { emit({ k: 'try', c: c.name, r: rooms[ri].name, res: 'fit' }); continue; }
        if (used[c.slot][ri]) { emit({ k: 'try', c: c.name, r: rooms[ri].name, res: 'clash' }); continue; }
        emit({ k: 'try', c: c.name, r: rooms[ri].name, res: 'ok' });
        used[c.slot][ri] = 1; pick[i] = ri;
        if (rec(i + 1)) return true;
        used[c.slot][ri] = 0; pick[i] = -1;
        if (st.aborted) return false;
        st.backtracks++;
        emit({ k: 'undo', c: c.name, r: rooms[ri].name });
      }
      return false;
    }

    const t0 = now();
    const ok = rec(0);
    const ms = now() - t0;
    const assignment = {};
    if (ok) order.forEach(function (c, i) { assignment[c.name] = rooms[pick[i]].name; });
    return { solved: ok, assignment: ok ? assignment : {}, nodes: st.nodes, backtracks: st.backtracks, ms: ms, aborted: st.aborted, truncated: st.truncated };
  }

  /* ---------- Backtracking + MRV + forward checking ----------
   * MRV: pick the unassigned course with the fewest remaining legal rooms.
   * Forward checking: taking room r removes r from every unassigned course in the
   * same slot; an empty domain means backtrack at once.  Pruned domains are
   * recorded so they can be restored exactly.
   */
  function solveSmart(rooms, courses, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || Infinity;
    const trace = opts.trace || null;
    const traceLimit = opts.traceLimit || 20000;

    const names = courses.map(function (c) { return c.name; });
    const cby = {};
    courses.forEach(function (c) { cby[c.name] = c; });
    const domains = {};
    courses.forEach(function (c) {
      domains[c.name] = new Set(rooms.filter(function (r) { return compatible(c, r); }).map(function (r) { return r.name; }));
    });
    const assign = {};
    let assigned = 0;
    const st = { nodes: 0, backtracks: 0, aborted: false, truncated: false };

    function emit(ev) {
      if (!trace) return;
      if (trace.length >= traceLimit) { st.truncated = true; return; }
      trace.push(ev);
    }

    function rec() {
      if (assigned === names.length) return true;
      // MRV: first course with the smallest domain (ties -> input order)
      let best = null, bestSize = Infinity;
      for (let i = 0; i < names.length; i++) {
        const x = names[i];
        if (Object.prototype.hasOwnProperty.call(assign, x)) continue;
        const sz = domains[x].size;
        if (sz < bestSize) { bestSize = sz; best = x; }
      }
      const c = best;
      const slot = cby[c].slot;
      emit({ k: 'pick', c: c, d: bestSize });
      const candidates = Array.from(domains[c]).sort();
      for (let k = 0; k < candidates.length; k++) {
        const r = candidates[k];
        st.nodes++;
        if (st.nodes > maxNodes) { st.aborted = true; return false; }
        const pruned = [];
        let ok = true, wiped = null;
        for (let j = 0; j < names.length; j++) {
          const c2 = names[j];
          if (c2 === c || Object.prototype.hasOwnProperty.call(assign, c2)) continue;
          if (cby[c2].slot === slot && domains[c2].has(r)) {
            domains[c2].delete(r); pruned.push(c2);
            if (domains[c2].size === 0) { ok = false; wiped = c2; break; }
          }
        }
        emit({ k: 'try', c: c, r: r, res: ok ? 'ok' : 'wipe', pruned: pruned.slice(), wiped: wiped });
        if (ok) {
          assign[c] = r; assigned++;
          if (rec()) return true;
          delete assign[c]; assigned--;
        }
        pruned.forEach(function (c2) { domains[c2].add(r); });
        if (st.aborted) return false;
        st.backtracks++;
        emit({ k: 'undo', c: c, r: r });
      }
      return false;
    }

    const t0 = now();
    const ok = rec();
    const ms = now() - t0;
    return { solved: ok, assignment: ok ? Object.assign({}, assign) : {}, nodes: st.nodes, backtracks: st.backtracks, ms: ms, aborted: st.aborted, truncated: st.truncated };
  }

  /* ---------- Independent verifier ---------- */
  function verify(rooms, courses, assignment) {
    const errors = [];
    const rby = {};
    rooms.forEach(function (r) { rby[r.name] = r; });
    const taken = {};
    courses.forEach(function (c) {
      const rn = assignment[c.name];
      if (!rn) { errors.push(c.name + ' has no room.'); return; }
      const r = rby[rn];
      if (!r) { errors.push(c.name + ' → unknown room ' + rn); return; }
      if (!compatible(c, r)) errors.push(c.name + ' (' + c.students + ', ' + c.needs + ') does not fit ' + rn + ' (' + r.capacity + ', ' + r.type + ').');
      const key = c.slot + '|' + rn;
      if (taken[key]) errors.push('Double booking: ' + taken[key] + ' and ' + c.name + ' both in ' + rn + ' in slot ' + c.slot + '.');
      else taken[key] = c.name;
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------- Random instances for the scaling experiment ----------
   * Built so a valid allocation is guaranteed: we first pick a distinct room for
   * every course in each slot, then choose a class size and room type that room
   * accepts.  Rooms per slot equal courses per slot, so the instance is tight
   * (the hardest case for a naive order).
   */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateInstance(nCourses, seed, slots) {
    slots = slots || 3;
    const rnd = mulberry32(seed);
    const ri = function (lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); };
    const pickOne = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    const shuffle = function (arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    };

    const base = Math.floor(nCourses / slots), extra = nCourses % slots;
    const counts = [];
    for (let s = 0; s < slots; s++) counts.push(base + (s < extra ? 1 : 0));
    const m = Math.max.apply(null, counts);

    const nHall = Math.max(1, Math.round(m * 0.2));
    const nLab = Math.max(1, Math.round(m * 0.3));
    const nLec = Math.max(1, m - nHall - nLab);
    const rooms = [];
    for (let i = 0; i < nLec; i++) rooms.push({ name: 'L' + String(i + 1).padStart(2, '0'), capacity: pickOne([40, 60]), type: 'lecture' });
    for (let i = 0; i < nHall; i++) rooms.push({ name: 'H' + String(i + 1).padStart(2, '0'), capacity: pickOne([90, 120]), type: 'hall' });
    for (let i = 0; i < nLab; i++) rooms.push({ name: 'LAB' + String(i + 1).padStart(2, '0'), capacity: pickOne([30, 45]), type: 'lab' });

    const courses = [];
    let idx = 1;
    for (let s = 0; s < slots; s++) {
      const chosen = shuffle(rooms).slice(0, counts[s]);
      chosen.forEach(function (room) {
        let needs, students;
        if (room.type === 'lab') { needs = 'lab'; students = ri(Math.ceil(room.capacity * 0.6), room.capacity); }
        else if (room.type === 'hall') {
          if (rnd() < 0.35) { needs = 'lecture'; students = ri(30, 60); }
          else { needs = 'hall'; students = ri(61, room.capacity); }
        } else { needs = 'lecture'; students = ri(Math.ceil(room.capacity * 0.5), room.capacity); }
        courses.push({ name: 'C' + String(idx++).padStart(2, '0'), students: students, needs: needs, slot: s + 1 });
      });
    }
    return { rooms: rooms, courses: courses };
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  const api = {
    SAMPLE_ROOMS: SAMPLE_ROOMS, SAMPLE_COURSES: SAMPLE_COURSES, clone: clone,
    compatible: compatible, conflict: conflict, validate: validate, buildDomains: buildDomains,
    solvePlain: solvePlain, solveSmart: solveSmart, verify: verify, generateInstance: generateInstance,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Solver = api;
})(typeof window !== 'undefined' ? window : globalThis);
