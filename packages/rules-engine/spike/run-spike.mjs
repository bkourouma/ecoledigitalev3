// Orchestrateur du spike ADR-003 : exécute la batterie pour chaque moteur, chaque cas dans un worker avec délai max.
import { Worker } from 'node:worker_threads';
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { baseAdapters, loadCustomPratt } from './adapters.mjs';
import { CASES } from './battery.mjs';

const TIMEOUT_MS = Number(process.env.SPIKE_TIMEOUT_MS ?? 6000);
const only = process.env.SPIKE_ONLY?.split(',');

function runCase(adapterId, caseId) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const w = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: { adapterId, caseId },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ status: 'TIMEOUT', detail: `>${TIMEOUT_MS} ms`, ms: Date.now() - t0 });
    }, TIMEOUT_MS);
    w.once('message', (r) => {
      clearTimeout(timer);
      w.terminate();
      resolve(r);
    });
    w.once('error', (e) => {
      clearTimeout(timer);
      resolve({ status: 'CRASH', detail: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 });
    });
  });
}

const adapters = [...baseAdapters];
const pratt = await loadCustomPratt();
if (pratt) adapters.push(pratt);

const results = {};
const selected = adapters.filter((a) => !only || only.includes(a.id));
const runAdapter = async (a) => {
  results[a.id] = {};
  for (const c of CASES) results[a.id][c.id] = await runCase(a.id, c.id);
};
if (process.env.SPIKE_SEQ === '1') {
  // séquentiel : évite que les boucles infinies des uns ne perturbent les mesures des autres
  for (const a of selected) await runAdapter(a);
} else {
  await Promise.all(selected.map(runAdapter));
}

// ---- perf : 100k évaluations de la note ECUE, expression compilée une fois
async function perf() {
  const out = {};
  const { CTX } = await import('./battery.mjs');
  for (const a of adapters.filter((x) => !only || only.includes(x.id))) {
    const f1 = CASES.find((c) => c.id === 'F1');
    const src = f1.expr[a.family];
    try {
      const compiled = a.compile(src);
      const N = a.family === 'jsonata' ? 5000 : 100000; // JSONata est asynchrone : moins d'itérations
      const t0 = performance.now();
      for (let i = 0; i < N; i++) await a.evaluate(compiled, CTX);
      const dt = performance.now() - t0;
      out[a.id] = { evalsPerSec: Math.round((N / dt) * 1000), N };
    } catch (e) {
      out[a.id] = { error: String(e.message).slice(0, 80) };
    }
  }
  return out;
}
const perfRes = await perf();

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), timeoutMs: TIMEOUT_MS, results, perf: perfRes }, null, 2));

// ---- affichage
const ids = Object.keys(results);
for (const c of CASES) {
  console.log(`\n[${c.id}] ${c.desc}`);
  for (const id of ids) {
    const r = results[id][c.id];
    console.log(`   ${id.padEnd(14)} ${String(r.status).padEnd(18)} ${r.detail ?? ''} ${r.ms !== undefined ? `(${r.ms} ms)` : ''}`);
  }
}
console.log('\nPERF (évaluations/s, expression compilée une fois):', JSON.stringify(perfRes));
