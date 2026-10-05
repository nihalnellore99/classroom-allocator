// Run with:  node test.js
const S = require('./solver.js');
let failed = 0;
function check(label, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failed++;
}

const rooms = S.clone(S.SAMPLE_ROOMS), courses = S.clone(S.SAMPLE_COURSES);
check('sample data validates', S.validate(rooms, courses).length === 0);

// Section 7.2 of the report: plain = 138 nodes / 4 backtracks, smart = 24 / 0
const p = S.solvePlain(rooms, courses);
const s = S.solveSmart(rooms, courses);
check('plain solved', p.solved);
check('plain nodes = 138', p.nodes === 138, 'got ' + p.nodes);
check('plain backtracks = 4', p.backtracks === 4, 'got ' + p.backtracks);
check('smart solved', s.solved);
check('smart nodes = 24', s.nodes === 24, 'got ' + s.nodes);
check('smart backtracks = 0', s.backtracks === 0, 'got ' + s.backtracks);
check('plain solution verifies', S.verify(rooms, courses, p.assignment).ok);
check('smart solution verifies', S.verify(rooms, courses, s.assignment).ok);

// Trace sanity: replaying the trace gives the same node/backtrack counts
['plain', 'smart'].forEach(function (kind) {
  const tr = [];
  const r = kind === 'plain' ? S.solvePlain(rooms, courses, { trace: tr }) : S.solveSmart(rooms, courses, { trace: tr });
  const nodes = tr.filter(function (e) { return e.k === 'try'; }).length;
  const bts = tr.filter(function (e) { return e.k === 'undo'; }).length;
  check(kind + ' trace matches counters', nodes === r.nodes && bts === r.backtracks, nodes + '/' + bts);
});

// Verifier catches mistakes
const bad = Object.assign({}, s.assignment, { CS201: s.assignment.CS101 });
check('verifier flags a double booking', !S.verify(rooms, courses, bad).ok);
const bad2 = Object.assign({}, s.assignment, { MA101: 'A101' });
check('verifier flags a too-small room', !S.verify(rooms, courses, bad2).ok);

// Unsolvable: two labs in the same slot, only one lab room
const r2 = [{ name: 'X', capacity: 50, type: 'lab' }];
const c2 = [{ name: 'a', students: 10, needs: 'lab', slot: 1 }, { name: 'b', students: 10, needs: 'lab', slot: 1 }];
check('plain reports no solution', !S.solvePlain(r2, c2).solved);
check('smart reports no solution', !S.solveSmart(r2, c2).solved);

// Scaling experiment: every generated instance must be solvable and verified
[24, 30, 36].forEach(function (n) {
  let pn = 0, sn = 0, allOk = true;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const inst = S.generateInstance(n, 1000 + n * 31 + i, 3);
    const a = S.solvePlain(inst.rooms, inst.courses, { maxNodes: 5e6 });
    const b = S.solveSmart(inst.rooms, inst.courses);
    if (!b.solved || !S.verify(inst.rooms, inst.courses, b.assignment).ok) allOk = false;
    if (a.solved && !S.verify(inst.rooms, inst.courses, a.assignment).ok) allOk = false;
    pn += a.nodes; sn += b.nodes;
  }
  check(n + ' courses: all instances solved + verified', allOk, 'avg plain nodes ' + Math.round(pn / N) + ', avg smart nodes ' + (sn / N).toFixed(1));
});

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll tests passed');
process.exit(failed ? 1 : 0);
