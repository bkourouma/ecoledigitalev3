# Bootstrap `alliance` (147.93.44.169) for EcoleDigitale

One-time setup. The base server is already hardened and running 4 other apps
(aspweb, gamrdigital, gestionrisques, imhotepformation, immotopia). This guide
adds EcoleDigitale alongside them without touching the existing stack.

All commands run as `deployer` unless prefixed with `sudo`.

SSH is on **port 2222**:
```bash
ssh -p 2222 deployer@147.93.44.169
```

---

## 0. What's already in place

- docker 29 + docker compose v2
- nginx 1.24, certbot 2.9
- node 20 + pnpm 10 (host-level — used by other apps via pm2)
- A GitHub Actions runner already registered to **`bkourouma/AssurMatch`**
  at `/home/deployer/actions-runner/`. **Do not touch it.** We add a
  second runner at `/home/deployer/actions-runner-ecoledigitale/`.

Port plan (host-side bindings, all to `127.0.0.1`):

| Port | Service               | Notes                            |
|------|-----------------------|----------------------------------|
| 8011 | ecoledigitale-api          | Fastify                                  |
| 3011 | ecoledigitale-web          | Next.js (3000/3010 taken by other apps)  |
| 3012 | ecoledigitale-formation-pro| Next.js — formation-pro-public           |
| 5433 | ecoledigitale-postgres     | host PG already on 5432                  |
| 9000 | minio API                  |                                          |
| 9001 | minio console              |                                          |

---

## 1. Repo + secrets (no sudo)

```bash
git clone https://github.com/bkourouma/EcoleDigitaleV2.git /home/deployer/ecoledigitale

# .env lives OUTSIDE the repo so workflow checkouts don't wipe it
cp /home/deployer/ecoledigitale/infra/.env.example /home/deployer/ecoledigitale.env
chmod 600 /home/deployer/ecoledigitale.env
nano /home/deployer/ecoledigitale.env   # fill in real secrets
```

Generate strong values:
```bash
openssl rand -hex 32      # JWT_SECRET, NEXTAUTH_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD, MINIO_PASSWORD
```

---

## 2. nginx + Let's Encrypt (sudo required)

DNS first: `ecoledigitale.allianceconsultants.net` → `147.93.44.169`. Verify:
```bash
dig +short ecoledigitale.allianceconsultants.net
```

Drop the vhost in:
```bash
sudo cp /home/deployer/ecoledigitale/infra/nginx/ecoledigitale.conf \
        /etc/nginx/sites-available/ecoledigitale
sudo ln -sf /etc/nginx/sites-available/ecoledigitale \
            /etc/nginx/sites-enabled/ecoledigitale
sudo nginx -t && sudo systemctl reload nginx
```

Issue cert (apex via HTTP-01 — automatic):
```bash
sudo certbot --nginx -d ecoledigitale.allianceconsultants.net \
             --agree-tos -m admin@allianceconsultants.net --no-eff-email
sudo systemctl reload nginx
```

Wildcard for tenant subdomains needs DNS-01 (manual or registrar plugin) and is
optional for first launch — add later if needed.

### formation-pro vhost (second domain)

Same flow for `formation-pro.allianceconsultants.net`. DNS first:
```bash
dig +short formation-pro.allianceconsultants.net   # 147.93.44.169
```

Stage 1 — drop a minimal HTTP-only vhost so certbot can issue:
```bash
sudo tee /etc/nginx/sites-available/formation-pro > /dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name formation-pro.allianceconsultants.net;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 200 "ok\n"; }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/formation-pro /etc/nginx/sites-enabled/formation-pro
sudo nginx -t && sudo systemctl reload nginx
```

Stage 2 — issue cert:
```bash
sudo certbot --nginx -d formation-pro.allianceconsultants.net \
             --agree-tos -m admin@allianceconsultants.net --no-eff-email --redirect
```

Stage 3 — swap in the real vhost:
```bash
sudo cp /home/deployer/ecoledigitale/infra/nginx/formation-pro.conf \
        /etc/nginx/sites-available/formation-pro
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. First DB seed (from local demo data)

On your **Windows workstation**:
```powershell
cd D:\APP\ecoledigitale
.\infra\scripts\dump-local-db.ps1
# produces infra\scripts\dumps\ecoledigitale-YYYYMMDD-HHMMSS.dump
```

Copy and restore (note port 2222):
```powershell
scp -P 2222 infra\scripts\dumps\ecoledigitale-*.dump `
    deployer@147.93.44.169:/tmp/ecoledigitale.dump
```

```bash
ssh -p 2222 deployer@147.93.44.169
cd /home/deployer/ecoledigitale
docker compose --env-file /home/deployer/ecoledigitale.env \
               -f infra/compose/docker-compose.yml -p ecoledigitale up -d postgres
bash infra/scripts/restore-db-on-server.sh /tmp/ecoledigitale.dump
rm /tmp/ecoledigitale.dump
```

---

## 4. Second GitHub Actions runner — for EcoleDigitaleV2

In GitHub: **bkourouma/EcoleDigitaleV2 → Settings → Actions → Runners → New self-hosted runner** (Linux/x64).
Copy the registration token GitHub gives you (valid ~1 hour).

```bash
mkdir -p /home/deployer/actions-runner-ecoledigitale
cd /home/deployer/actions-runner-ecoledigitale

# reuse the tarball already on disk from the AssurMatch install
tar xzf /home/deployer/actions-runner/actions-runner-linux-x64-2.334.0.tar.gz

./config.sh --url https://github.com/bkourouma/EcoleDigitaleV2 \
            --token <REGISTRATION_TOKEN> \
            --labels alliance-ecoledigitale \
            --name alliance-ecoledigitale \
            --work _work \
            --unattended

# install as a systemd service named svc-ecoledigitale (sudo required)
sudo ./svc.sh install deployer
sudo ./svc.sh start
sudo ./svc.sh status
```

The workflow targets `runs-on: [self-hosted, alliance-ecoledigitale]`, so the
label string is what matters.

**Security note:** keep the EcoleDigitaleV2 repo private. A self-hosted runner
on a public repo will execute arbitrary code from any fork PR.

---

## 5. First deploy

Push to `main` (or **Run workflow** in the Actions tab). The runner will:

1. Check out into `/home/deployer/actions-runner-ecoledigitale/_work/EcoleDigitaleV2/EcoleDigitaleV2`
2. Build api + web + formation-pro images
3. `docker compose up -d` (api, web, formation-pro, postgres, minio)
4. Wait for the API healthcheck
5. Smoke-test `https://ecoledigitale.allianceconsultants.net/health`

The named volumes (`ecoledigitale-postgres-data`, `ecoledigitale-minio-data`)
survive across runs — image rebuilds don't wipe data.

---

## 6. Verification

```bash
docker compose -p ecoledigitale ps
docker compose -p ecoledigitale logs --tail=100 ecoledigitale-api
curl -s https://ecoledigitale.allianceconsultants.net/health
```

---

## Google OAuth setup (formation-pro sign-in)

formation-pro lets users sign in with Google via next-auth. You need a Google
OAuth 2.0 Client ID + Secret, scoped to your formation-pro origin.

1. Open https://console.cloud.google.com → top bar **Select a project** → **NEW PROJECT** (e.g. `alliance-formation-pro`). Wait ~30s, then select it.
2. Left nav → **APIs & Services → OAuth consent screen** → choose **External** → fill in:
   - **App name:** `Formation Pro Alliance`
   - **User support email:** your email
   - **App logo:** (optional)
   - **App domain → Authorized domain:** `allianceconsultants.net`
   - **Developer contact:** your email
   - Click **Save and continue** through Scopes (no scopes to add) and Test users (add your email there if you keep the app in "Testing" status). Publish to "In production" to allow any Google user.
3. Left nav → **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - **Application type:** Web application
   - **Name:** `formation-pro production`
   - **Authorized JavaScript origins:** `https://formation-pro.allianceconsultants.net`
   - **Authorized redirect URIs:** `https://formation-pro.allianceconsultants.net/api/auth/callback/google`
   - Click **Create**. Copy the **Client ID** and **Client secret**.
4. Paste into `/home/deployer/ecoledigitale.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
5. Restart formation-pro to pick up the env:
   ```bash
   cd /home/deployer/ecoledigitale
   ENV_FILE=/home/deployer/ecoledigitale.env \
     docker compose --env-file $ENV_FILE -f infra/compose/docker-compose.yml \
     -p ecoledigitale up -d --force-recreate ecoledigitale-formation-pro
   ```

Until step 4 is done, the "Sign in with Google" button is hidden and email-only sign-in is the only option.

---

## Operational notes

- **Backups:** schedule `pg_dump` of the docker volume to `/var/backups/ecoledigitale/` via cron.
- **AIDE drift:** after this bootstrap, re-run `sudo aide --update` and replace
  `/var/lib/aide/aide.db` so the daily check stays quiet.
- **Renewal:** `sudo certbot renew --dry-run` once before the first auto-renew.
- **Two runners coexist:** the AssurMatch runner and the EcoleDigitale runner pick
  up jobs based on labels, not name. Don't mix label strings between repos.
