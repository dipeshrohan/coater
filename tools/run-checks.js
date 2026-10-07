/*
 * run-checks.js — every check in one command: the paths, the generated files, then each checks/*.validate.js.
 *   node tools/run-checks.js                  all of them, one at a time
 *   node tools/run-checks.js sheet furnace    only the checks whose names hold these words
 *   node tools/run-checks.js --jobs 4         four at a time (the long ones take minutes each)
 * Prints one line per check (ok or FAILED, and its time) and the end of a failed check's output; exits 1 on a failure.
 */
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2), j = argv.indexOf('--jobs');
const jobs = j >= 0 ? Math.max(1, +argv[j + 1] || 1) : 1;
const words = argv.filter((a, i) => !a.startsWith('--') && !(j >= 0 && i === j + 1));

const runs = [
  ['paths', ['tools/check-paths.js']],
  ['workers-src.js', ['tools/build-workers.js', '--check']],
  ['occt-import-js.wasm.js', ['tools/build-occt.js', '--check']],
  ...fs.readdirSync(path.join(ROOT, 'checks')).filter(f => f.endsWith('.validate.js')).sort()
    .map(f => [f.replace('.validate.js', ''), ['checks/' + f]]),
].filter(([name]) => !words.length || words.some(w => name.includes(w)));

const failed = [];
function run([name, args]) {
  return new Promise(done => {
    const t0 = Date.now(), p = spawn(process.execPath, args, { cwd: ROOT });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => {
      const s = ((Date.now() - t0) / 1000).toFixed(0) + ' s';
      if (code === 0) console.log(`ok      ${name} (${s})`);
      else {
        failed.push(name);
        console.log(`FAILED  ${name} (${s}, exit ${code})\n` + out.trimEnd().split('\n').slice(-15).map(l => '        ' + l).join('\n'));
      }
      done();
    });
  });
}
(async () => {
  const queue = runs.slice();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));
  console.log(failed.length ? `\n${failed.length} of ${runs.length} failed: ${failed.join(', ')}` : `\nall ${runs.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
