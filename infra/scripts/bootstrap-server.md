# Bootstrap srv917891 for EcoleDigitale

One-time setup. Runs **after** the hardening doc (`alliance_server-hardening-srv917891.md`)
and **before** the first GitHub Actions deploy. All commands run as `deployer` unless noted.

---

## 0. Prereqs (verify, don't re-do)

```bash
ssh deployer@147.93.44.169
sudo ufw status            # 22, 80, 443 open
systemctl is-active fail2ban sshd
uname -r                   # should be 6.8.0-111+ post-reboot
```

---

## 1. Install runtimes

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx \
                    docker.io docker-compose-plugin \
                    git curl jq

# allow deployer to use docker without sudo
sudo usermod -aG docker deployer
# log out and back in for the group to take effect

docker --version && docker compose version
```

---

## 2. Repo + secrets

```bash
sudo mkdir -p /opt/ecoledigitale
sudo chown deployer:deployer /opt/ecoledigitale
git clone https://github.com/bkourouma/EcoleDigitaleV2.git /opt/ecoledigitale

# .env lives OUTSIDE the repo so workflow checkouts don't wipe it
cp /opt/ecoledigitale/infra/.env.example /home/deployer/ecoledigitale.env
chmod 600 /home/deployer/ecoledigitale.env
nano /home/deployer/ecoledigitale.env   # fill in real secrets
```

Generate strong values:
```bash
openssl rand -hex 32   # for JWT_SECRET, NEXTAUTH_SECRET
openssl rand -base64 24   # for POSTGRES_PASSWORD, MINIO_PASSWORD
```

---

## 3. nginx + Let's Encrypt

DNS first: point `ecoledigitale.allianceconsultants.net` (and `*.ecoledigitale.allianceconsultants.net`
if you need tenant subdomains) to `147.93.44.169`. Verify with `dig +short`.

Drop in the vhost:
```bash
sudo cp /opt/ecoledigitale/infra/nginx/ecoledigitale.conf \
        /etc/nginx/sites-available/ecoledigitale
sudo ln -sf /etc/nginx/sites-available/ecoledigitale \
            /etc/nginx/sites-enabled/ecoledigitale
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Issue the cert. The wildcard requires DNS-01 (manual or with the right plugin); without it,
just the apex works via HTTP-01:

```bash
# apex only (HTTP-01, automatic):
sudo certbot --nginx -d ecoledigitale.allianceconsultants.net \
             --agree-tos -m admin@allianceconsultants.net --no-eff-email

# apex + wildcard (DNS-01, manual TXT records — repeat for each renewal unless you
# use a DNS plugin matching your registrar):
# sudo certbot certonly --manual --preferred-challenges dns \
#              -d ecoledigitale.allianceconsultants.net \
#              -d '*.ecoledigitale.allianceconsultants.net'

sudo systemctl reload nginx
```

Certbot adds a systemd timer for renewal automatically (`systemctl list-timers | grep certbot`).

---

## 4. First DB seed (from your local demo data)

On your **Windows workstation**, dump the local DB:
```powershell
cd D:\APP\ecoledigitale
.\infra\scripts\dump-local-db.ps1
# produces infra\scripts\dumps\ecoledigitale-YYYYMMDD-HHMMSS.dump
```

Copy and restore:
```powershell
scp infra\scripts\dumps\ecoledigitale-*.dump deployer@147.93.44.169:/tmp/ecoledigitale.dump
ssh deployer@147.93.44.169
```

```bash
# on server — bring postgres up first, then restore
cd /opt/ecoledigitale
docker compose --env-file /home/deployer/ecoledigitale.env \
               -f infra/compose/docker-compose.yml -p ecoledigitale up -d postgres

bash infra/scripts/restore-db-on-server.sh /tmp/ecoledigitale.dump
rm /tmp/ecoledigitale.dump
```

---

## 5. Register the GitHub Actions self-hosted runner

In GitHub: **Settings → Actions → Runners → New self-hosted runner** (Linux/x64).
Copy the token GitHub gives you, then on the server:

```bash
sudo mkdir -p /opt/actions-runner
sudo chown deployer:deployer /opt/actions-runner
cd /opt/actions-runner

# version per GitHub's runner page; update if newer
curl -o runner.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-linux-x64-2.319.1.tar.gz
tar xzf runner.tar.gz && rm runner.tar.gz

./config.sh --url https://github.com/bkourouma/EcoleDigitaleV2 \
            --token <RUNNER_TOKEN_FROM_GITHUB> \
            --labels srv917891 \
            --name srv917891 \
            --unattended

# install as a systemd service (runs as deployer)
sudo ./svc.sh install deployer
sudo ./svc.sh start
sudo ./svc.sh status
```

The workflow targets `runs-on: [self-hosted, srv917891]`, so the `srv917891` label matters.

**Security note:** keep the repo private. A self-hosted runner on a public repo will execute
arbitrary code from any fork PR.

---

## 6. First deploy

Push to `main` (or click **Run workflow** in the Actions tab). The runner will:
1. Check out the repo into `/opt/actions-runner/_work/EcoleDigitaleV2/EcoleDigitaleV2`
2. Build the API + web images
3. `docker compose up -d` the full stack (api, web, postgres, minio)
4. Wait for the API healthcheck
5. Smoke-test `https://ecoledigitale.allianceconsultants.net/health`

Note: the workflow's checkout dir is **separate** from `/opt/ecoledigitale` (used for the
initial DB restore). Both reference the same compose file via the env file at
`/home/deployer/ecoledigitale.env`, and the named volumes (`ecoledigitale-postgres-data`,
`ecoledigitale-minio-data`) survive across runs.

---

## 7. Post-deploy verification

```bash
docker compose -p ecoledigitale ps
docker compose -p ecoledigitale logs --tail=100 ecoledigitale-api
curl -s https://ecoledigitale.allianceconsultants.net/health
```

If something looks wrong, the named postgres volume keeps your seeded data — you can rebuild
images without losing the database.

---

## Operational notes

- **Backups:** schedule `pg_dump` of the docker volume to `/var/backups/ecoledigitale/` via cron.
  Same with the `minio_data` volume.
- **AIDE drift:** after this bootstrap, re-run `sudo aide --update` and replace
  `/var/lib/aide/aide.db` so the daily check stays quiet.
- **Renewal sanity check:** `sudo certbot renew --dry-run` once before the first auto-renew.
