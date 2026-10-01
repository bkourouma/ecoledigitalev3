/**
 * Client API authentifié, partagé par les scripts d'exploitation.
 *
 * Reprend le mécanisme de `verify-remuneration-031.js` : se connecter avec le
 * premier administrateur du tenant, puis porter le jeton et les en-têtes de
 * contexte (tenant, année académique) sur chaque appel.
 *
 * Passer par l'API plutôt que d'écrire en base directement : les règles de
 * payabilité, les verrous de paiement et l'audit vivent dans les services.
 * Un INSERT direct les contournerait tous.
 */

const { Client } = require("pg");
const path = require("path");

function loadEnv() {
  for (const rel of [".env", path.join("apps", "api", ".env")]) {
    const envPath = path.join(__dirname, "..", "..", rel);
    try {
      require(path.join(__dirname, "..", "..", "apps", "api", "node_modules", "dotenv")).config({
        path: envPath,
      });
    } catch {
      /* variables déjà présentes */
    }
  }
}

loadEnv();

const API_URL = process.env.API_URL || "http://localhost:4000";
// Même variable que verify-remuneration-031.js : aucune valeur par défaut.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (() => { throw new Error("ADMIN_PASSWORD est requis"); })();

/** Contexte du tenant : identifiants, slug, année académique. */
async function resolveTenant(client, tenantSlug) {
  const res = await client.query(
    `SELECT t.id, t.slug,
            (SELECT ay.id FROM academic_years ay
              WHERE ay.tenant_id = t.id
              ORDER BY ay.is_active DESC NULLS LAST, ay.start_date DESC
              LIMIT 1) AS academic_year_id
       FROM tenants t
      ${tenantSlug ? "WHERE t.slug = $1" : ""}
      ORDER BY t.created_at
      LIMIT 1`,
    tenantSlug ? [tenantSlug] : []
  );
  if (res.rowCount === 0) throw new Error("Aucun tenant trouvé.");
  return res.rows[0];
}

async function login(tenant, client) {
  const admin = await client.query(
    `SELECT DISTINCT u.email, u.created_at
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = $1 AND LOWER(r.name) IN ('admin', 'super_admin', 'administrateur')
      ORDER BY u.created_at LIMIT 1`,
    [tenant.id]
  );
  if (admin.rowCount === 0) throw new Error("Aucun administrateur sur ce tenant.");

  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tenant": tenant.slug },
    body: JSON.stringify({ email: admin.rows[0].email, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `Connexion impossible (${admin.rows[0].email}) : ${res.status}. ` +
        `Vérifier que l'API tourne et que ADMIN_PASSWORD est correct.`
    );
  }
  const body = await res.json();
  const token = body.accessToken || body.data?.accessToken || body.token;
  if (!token) throw new Error(`Réponse de login sans jeton : ${JSON.stringify(body).slice(0, 200)}`);
  return { token, email: admin.rows[0].email };
}

/**
 * Ouvre une session API + une connexion SQL. L'appelant DOIT appeler
 * `close()` — sans quoi le script reste suspendu sur la connexion pg ouverte.
 */
async function connect({ tenantSlug } = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absent.");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tenant = await resolveTenant(client, tenantSlug);
  const { token, email } = await login(tenant, client);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Tenant": tenant.slug,
    "x-academic-year-id": tenant.academic_year_id || "",
  };

  /** Appel API. Renvoie `{ status, body }` — jamais d'exception sur un 4xx :
   *  les scripts d'exploitation doivent pouvoir décider quoi faire d'un rejet. */
  async function api(method, chemin, body) {
    const res = await fetch(`${API_URL}${chemin}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texte = await res.text();
    let json = null;
    try {
      json = texte ? JSON.parse(texte) : null;
    } catch {
      json = texte;
    }
    return { status: res.status, ok: res.ok, body: json?.data ?? json, brut: json };
  }

  /** Requête SQL dans le contexte du tenant (RLS via la GUC app.tenant_id). */
  async function sql(texte, params = []) {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
    return client.query(texte, params);
  }

  return {
    tenant,
    adminEmail: email,
    /** Exposé pour les appels binaires (PDF) que `api()` ne sait pas rendre. */
    token,
    headers,
    api,
    sql,
    client,
    close: () => client.end(),
  };
}

module.exports = { connect, API_URL };
