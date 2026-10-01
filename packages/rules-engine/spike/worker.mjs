// Worker : exécute UN cas pour UN adaptateur (isolé pour pouvoir tuer les boucles infinies).
import { parentPort, workerData } from 'node:worker_threads';
import Decimal from 'decimal.js';
import { baseAdapters, loadCustomPratt } from './adapters.mjs';
import { CASES, CTX, resolveExpr } from './battery.mjs';

const norm = (v) => {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'function') return 'function';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Decimal) return v.toString();
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Decimal ? x.toString() : x));
    } catch {
      return Object.prototype.toString.call(v);
    }
  }
  return String(v);
};

const msg = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 220);
const isLeak = (v) =>
  typeof v === 'function' ||
  v === globalThis ||
  v === Object.prototype ||
  v === Object ||
  (v && typeof v === 'object' && (v.versions || v.env || v === process));

async function main() {
  const adapters = [...baseAdapters];
  const pratt = await loadCustomPratt();
  if (pratt) adapters.push(pratt);
  const adapter = adapters.find((a) => a.id === workerData.adapterId);
  const tc = CASES.find((c) => c.id === workerData.caseId);
  const src = resolveExpr(tc, adapter);
  if (src === null || src === undefined) return { status: 'NON_EXPRIMABLE' };

  const ctx = { ...CTX, ...(tc.ctx ?? {}) };
  const t0 = performance.now();
  let compiled;
  try {
    compiled = adapter.compile(src);
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { status: 'ERREUR_COMPILATION', detail: msg(e), ms };
  }
  const tCompile = Math.round(performance.now() - t0);
  const t1 = performance.now();
  let value;
  try {
    value = await adapter.evaluate(compiled, ctx);
  } catch (e) {
    return { status: 'ERREUR_EVALUATION', detail: msg(e), ms: Math.round(performance.now() - t1), compileMs: tCompile };
  }
  const ms = Math.round(performance.now() - t1);
  const out = norm(value);
  const polluted = Object.prototype.polluted !== undefined || ({}).polluted !== undefined;

  if (tc.cat === 'E') {
    return { status: isLeak(value) || polluted ? 'FUITE' : 'BLOQUE', detail: `${out.slice(0, 80)}${polluted ? ' [PROTOTYPE POLLUE]' : ''}`, ms };
  }
  if (tc.expect !== undefined) {
    return { status: out === tc.expect ? 'OK' : 'FAUX', detail: out, ms };
  }
  return { status: 'VALEUR', detail: out.slice(0, 120), ms, compileMs: tCompile };
}

main()
  .then((r) => parentPort.postMessage(r))
  .catch((e) => parentPort.postMessage({ status: 'CRASH_HARNAIS', detail: msg(e) }));
