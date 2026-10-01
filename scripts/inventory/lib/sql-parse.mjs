// Parseur SQL minimal pour l'inventaire des tables (aucune dépendance).
// Objectif : rejouer, dans l'ordre, les CREATE TABLE / ALTER TABLE ... RENAME /
// DROP TABLE / ADD COLUMN tenant_id d'une suite de migrations et en déduire
// l'ETAT FINAL des tables. Ce n'est pas un vrai parseur SQL : il couvre le
// dialecte effectivement utilisé dans ce dépôt (Postgres, DO $$ ... $$).

/** Découpe un script en instructions (séparateur ';'), en respectant
 *  commentaires, chaînes '...', identifiants "...", dollar-quoting $tag$...$tag$.
 *  Les commentaires sont retirés ; chaînes et corps dollar-quotés sont conservés. */
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === '-' && c2 === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      cur += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && sql[j] !== '"') j++;
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Retire les guillemets d'un identifiant et force la minuscule. */
export function unq(s) {
  return s.replace(/"/g, '').toLowerCase();
}

// identifiant éventuellement qualifié : "public"."x", public.x, x
const IDENT = String.raw`(?:"?[A-Za-z_][\w$]*"?\s*\.\s*)?"?([A-Za-z_][\w$]*)"?`;

export function tableName(raw) {
  const m = new RegExp('^' + IDENT).exec(raw.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Index de la parenthèse fermante correspondant à l'ouvrante en `start`. */
export function matchParen(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; } if (s[j] === "'") break; j++; }
      i = j; continue;
    }
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Découpe sur les virgules de niveau 0. */
export function splitTopLevel(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; } if (s[j] === "'") break; j++; }
      cur += s.slice(i, j + 1); i = j; continue;
    }
    if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') j++; cur += s.slice(i, j + 1); i = j; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const CONSTRAINT_STARTS = /^(constraint|primary|foreign|unique|check|like|exclude)\b/i;

/** Extrait les colonnes et les FK d'un corps de CREATE TABLE. */
export function parseCreateBody(body) {
  const columns = [];
  const fks = new Set();
  for (const item of splitTopLevel(body)) {
    const refs = [...item.matchAll(new RegExp(String.raw`REFERENCES\s+` + IDENT, 'gi'))].map((m) => m[1].toLowerCase());
    refs.forEach((r) => fks.add(r));
    if (CONSTRAINT_STARTS.test(item)) continue;
    const m = /^"?([A-Za-z_][\w$]*)"?\s+(\S+)/.exec(item);
    if (m) {
      const col = m[1].toLowerCase();
      columns.push({ name: col, notNull: /\bNOT\s+NULL\b/i.test(item) || /\bPRIMARY\s+KEY\b/i.test(item) });
    }
  }
  return { columns, fks: [...fks] };
}

/**
 * Rejoue une liste de fichiers {name, text} dans l'ordre fourni.
 * Retourne { tables: Map<name, T>, dropped: [...], views: Map, unresolved: [...] }.
 * T = { name, createdIn, createdVia, columns:Set, tenantIdCol, tenantIdNotNull, rls, fks:Set,
 *       renamedFrom:[...], history:[...] }
 *
 * options.bulkTenantize : { file: string, exclude: Set } — migration qui ajoute tenant_id + RLS
 *   à toutes les tables existantes (boucle DO dynamique non rejouable statiquement).
 */
export function replayMigrations(files, options = {}) {
  const tables = new Map();
  const dropped = [];
  const views = new Map();
  const unresolved = [];
  const everCreated = new Map(); // name -> [{file, ...}]

  const hist = (t, file, ev) => t.history.push({ file, ev });

  function createTable(name, file, parsed, conditional, via) {
    if (tables.has(name)) {
      hist(tables.get(name), file, 'create (déjà existante : IF NOT EXISTS ou doublon)');
      // fusionne colonnes inconnues
      for (const c of parsed.columns) if (!tables.get(name).columns.has(c.name)) tables.get(name).columns.add(c.name);
      parsed.fks.forEach((f) => tables.get(name).fks.add(f));
      return;
    }
    const t = {
      name,
      createdIn: file,
      createdVia: via,
      conditional,
      columns: new Set(parsed.columns.map((c) => c.name)),
      tenantIdCol: parsed.columns.some((c) => c.name === 'tenant_id'),
      tenantIdNotNull: parsed.columns.some((c) => c.name === 'tenant_id' && c.notNull),
      tenantIdAddedIn: parsed.columns.some((c) => c.name === 'tenant_id') ? file : null,
      rls: false,
      rlsIn: null,
      fks: new Set(parsed.fks),
      renamedFrom: [],
      history: [],
    };
    hist(t, file, 'create');
    tables.set(name, t);
    if (!everCreated.has(name)) everCreated.set(name, []);
    everCreated.get(name).push(file);
  }

  function dropTable(name, file, conditional) {
    const t = tables.get(name);
    if (t) {
      hist(t, file, 'drop');
      dropped.push({ name, createdIn: t.createdIn, droppedIn: file, conditional, recreated: false });
      tables.delete(name);
    } else {
      unresolved.push({ file, kind: 'drop-unknown-table', name });
    }
  }

  function applyAlter(name, actionsText, file, conditional) {
    const actions = splitTopLevel(actionsText);
    for (const act of actions) {
      let m;
      if ((m = new RegExp(String.raw`^RENAME\s+TO\s+` + IDENT, 'i').exec(act))) {
        const to = m[1].toLowerCase();
        const t = tables.get(name);
        if (!t) { unresolved.push({ file, kind: 'rename-unknown-table', name, to }); continue; }
        tables.delete(name);
        t.renamedFrom.push({ from: name, in: file });
        hist(t, file, `rename ${name} -> ${to}`);
        t.name = to;
        tables.set(to, t);
        name = to;
        continue;
      }
      const t = tables.get(name);
      if (!t) continue;
      if ((m = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][\w$]*)"?\s+(\S+)/i.exec(act)) && !/^ADD\s+(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)/i.test(act)) {
        const col = m[1].toLowerCase();
        t.columns.add(col);
        if (col === 'tenant_id') {
          t.tenantIdCol = true;
          t.tenantIdNotNull = /\bNOT\s+NULL\b/i.test(act);
          t.tenantIdAddedIn = t.tenantIdAddedIn || file;
        }
      }
      for (const r of act.matchAll(new RegExp(String.raw`REFERENCES\s+` + IDENT, 'gi'))) t.fks.add(r[1].toLowerCase());
      if ((m = /^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z_][\w$]*)"?/i.exec(act))) {
        const col = m[1].toLowerCase();
        t.columns.delete(col);
        if (col === 'tenant_id') { t.tenantIdCol = false; hist(t, file, 'drop column tenant_id'); }
      }
      if ((m = /^RENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i.exec(act))) {
        t.columns.delete(m[1].toLowerCase()); t.columns.add(m[2].toLowerCase());
        if (m[1].toLowerCase() === 'tenant_id') t.tenantIdCol = false;
        if (m[2].toLowerCase() === 'tenant_id') t.tenantIdCol = true;
      }
      if (/^ALTER\s+(?:COLUMN\s+)?"?tenant_id"?\s+SET\s+NOT\s+NULL/i.test(act)) t.tenantIdNotNull = true;
      if (/^ALTER\s+(?:COLUMN\s+)?"?tenant_id"?\s+DROP\s+NOT\s+NULL/i.test(act)) t.tenantIdNotNull = false;
      if (/^ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(act) || /^FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(act)) { t.rls = true; t.rlsIn = t.rlsIn || file; }
      if (/^DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(act)) { t.rls = false; }
    }
  }

  const reCreateTable = new RegExp(String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?` + IDENT + String.raw`\s*(\(|AS\b|PARTITION\b|INHERITS\b|WITH\b)`, 'i');
  const reCreateTemp = /CREATE\s+(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+TABLE/i;
  const reDrop = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+CASCADE|\s+RESTRICT)?\s*$/i;
  const reAlter = new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?` + IDENT + String.raw`\s+([\s\S]+)$`, 'i');
  const reView = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?` + IDENT, 'i');
  const reDropView = new RegExp(String.raw`DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?` + IDENT, 'i');
  const rePolicy = new RegExp(String.raw`CREATE\s+POLICY\s+\S+\s+ON\s+` + IDENT, 'i');

  function handleFragment(frag, file, conditional, anchored) {
    const f = frag.trim();
    if (!f) return;
    const test = (re) => (anchored ? new RegExp('^' + re.source, re.flags).exec(f) : re.exec(f));
    if (anchored && /^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|AGGREGATE|TYPE|EXTENSION|INDEX|UNIQUE\s+INDEX|SEQUENCE)\b/i.test(f)) return;
    let m;
    if (reCreateTemp.test(f.slice(0, 80))) return;
    if ((m = test(reCreateTable))) {
      const name = m[1].toLowerCase();
      let parsed = { columns: [], fks: [] };
      if (m[2] === '(') {
        const open = f.indexOf('(', m.index + m[0].length - 1);
        const close = matchParen(f, open);
        if (close > open) parsed = parseCreateBody(f.slice(open + 1, close));
      }
      createTable(name, file, parsed, conditional, m[2] === 'AS' ? 'ctas' : 'ddl');
      return;
    }
    if (/^DROP\s+TABLE\b/i.test(f) || (!anchored && /\bDROP\s+TABLE\b/i.test(f))) {
      m = reDrop.exec(f);
      if (m) {
        for (const item of (m[1] || '').split(',')) {
          const nm = tableName(item.trim());
          if (nm && !nm.startsWith('tmp_')) dropTable(nm, file, conditional);
        }
        return;
      }
    }
    if ((m = test(reView))) {
      views.set(m[1].toLowerCase(), { name: m[1].toLowerCase(), createdIn: file, droppedIn: null });
      return;
    }
    if ((m = test(reDropView))) {
      const v = views.get(m[1].toLowerCase());
      if (v) v.droppedIn = file;
      return;
    }
    if ((m = test(rePolicy))) {
      const t = tables.get(m[1].toLowerCase());
      if (t) { t.rls = true; t.rlsIn = t.rlsIn || file; t.policyIn = file; }
      return;
    }
    if ((m = test(reAlter))) {
      const name = m[1].toLowerCase();
      applyAlter(name, m[2], file, conditional);
      return;
    }
  }

  for (const { name: file, text } of files) {
    const stmts = splitStatements(text);
    for (const st of stmts) {
      if (/^DO\b/i.test(st)) {
        const bm = /\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*)\$\1?\$/.exec(st);
        const body = bm ? bm[2] : st;
        for (const frag of splitStatements(body)) {
          // fragments PL/pgSQL : "IF ... THEN DROP TABLE x" ; EXECUTE '...'
          if (/\bEXECUTE\b/i.test(frag)) {
            // SQL dynamique : on lit les chaînes littérales EXECUTE '....'
            for (const sm of frag.matchAll(/'((?:[^']|'')*)'/g)) {
              const s = sm[1].replace(/''/g, "'");
              if (/^\s*(CREATE|DROP|ALTER)\s/i.test(s)) handleFragment(s, file, true, true);
              else if (/\b(CREATE|DROP)\s+TABLE\b/i.test(s)) unresolved.push({ file, kind: 'dynamic-sql', text: s.slice(0, 120) });
            }
          } else {
            handleFragment(frag, file, true, false);
          }
        }
        continue;
      }
      handleFragment(st, file, false, true);
    }
    if (options.bulkTenantize && options.bulkTenantize.file === file) {
      for (const t of tables.values()) {
        if (options.bulkTenantize.exclude.has(t.name)) continue;
        if (!t.tenantIdCol) { t.tenantIdCol = true; t.tenantIdNotNull = true; t.tenantIdAddedIn = file + ' (boucle DO)'; hist(t, file, 'tenant_id ajouté par boucle DO'); }
        t.rls = true; t.rlsIn = t.rlsIn || file + ' (boucle DO)';
      }
    }
  }
  // marque les tables supprimées puis recréées
  for (const d of dropped) if (tables.has(d.name)) d.recreated = true;
  return { tables, dropped, views, unresolved, everCreated };
}
