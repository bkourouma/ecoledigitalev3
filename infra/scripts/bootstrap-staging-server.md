# Bootstrap staging server (82.29.174.93)

Target:

- Domain: `staging-ecoledigitale.allianceconsultants.net`
- Server: `82.29.174.93`
- User: `deployer`
- GitHub Actions runner label: `alliance-ecoledigitale-staging`
- App env file: `/home/deployer/ecoledigitale-staging.env`

The CI/CD workflow deploys staging through a self-hosted runner on this server.
With this setup, GitHub does not need a `VPS_SSH_KEY` secret for deployment.

## 0. Local SSH key

If the key does not exist on your Windows workstation yet:

```powershell
ssh-keygen -t ed25519 -C "deployer@ecoledigitale-staging" -f "$env:USERPROFILE\.ssh\id_ed25519"
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

Add the public key output to `/home/deployer/.ssh/authorized_keys` on the VPS
using the provider console or any temporary password access. Keep the private
key local. The command below copies the private key only if you later choose an
SSH-based GitHub Actions deploy, which this repository no longer requires:

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519" -Raw | Set-Clipboard
```

Then test:

```powershell
ssh deployer@82.29.174.93
```

## 1. Server prerequisites

Run on the VPS as a sudo-capable user:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git gnupg nginx certbot python3-certbot-nginx
```

Install Docker Engine and the Compose plugin if they are not installed yet:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deployer
```

Log out and back in so the `deployer` user picks up the `docker` group, then
verify:

```bash
docker --version
docker compose version
```

## 2. Repo and environment file

```bash
git clone https://github.com/bkourouma/EcoleDigitaleV2.git /home/deployer/ecoledigitale

cp /home/deployer/ecoledigitale/infra/.env.example /home/deployer/ecoledigitale-staging.env
chmod 600 /home/deployer/ecoledigitale-staging.env
nano /home/deployer/ecoledigitale-staging.env
```

Recommended staging values to update in the env file:

```bash
CORS_ORIGIN=https://staging-ecoledigitale.allianceconsultants.net
NEXTAUTH_URL=https://staging-ecoledigitale.allianceconsultants.net
NEXT_PUBLIC_APP_URL=https://staging-ecoledigitale.allianceconsultants.net
```

Generate strong secrets:

```bash
openssl rand -hex 32
openssl rand -base64 24
```

## 3. Nginx and TLS

Make sure DNS points to the VPS first:

```bash
dig +short staging-ecoledigitale.allianceconsultants.net
```

Expected result: `82.29.174.93`.

Install the staging vhost:

```bash
sudo cp /home/deployer/ecoledigitale/infra/nginx/ecoledigitale-staging.conf \
        /etc/nginx/sites-available/ecoledigitale-staging
sudo ln -sf /etc/nginx/sites-available/ecoledigitale-staging \
            /etc/nginx/sites-enabled/ecoledigitale-staging
sudo nginx -t && sudo systemctl reload nginx
```

Issue the certificate:

```bash
sudo certbot --nginx -d staging-ecoledigitale.allianceconsultants.net \
             --agree-tos -m admin@allianceconsultants.net --no-eff-email
sudo systemctl reload nginx
```

## 4. GitHub Actions runner

In GitHub, open:

`bkourouma/EcoleDigitaleV2 -> Settings -> Actions -> Runners -> New self-hosted runner -> Linux x64`

Copy the registration token from GitHub, then run on the staging VPS:

```bash
mkdir -p /home/deployer/actions-runner-ecoledigitale-staging
cd /home/deployer/actions-runner-ecoledigitale-staging

curl -o actions-runner-linux-x64-2.334.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.334.0/actions-runner-linux-x64-2.334.0.tar.gz
tar xzf actions-runner-linux-x64-2.334.0.tar.gz

./config.sh --url https://github.com/bkourouma/EcoleDigitaleV2 \
            --token <REGISTRATION_TOKEN> \
            --labels alliance-ecoledigitale-staging \
            --name alliance-ecoledigitale-staging \
            --work _work \
            --unattended

sudo ./svc.sh install deployer
sudo ./svc.sh start
sudo ./svc.sh status
```

The workflow targets `runs-on: [self-hosted, alliance-ecoledigitale-staging]`.
The label must match exactly.

## 5. First deploy and verification

Push to `main` or run the workflow manually. The staging job runs first, then
production runs only if staging succeeds.

On the VPS:

```bash
docker compose -p ecoledigitale-staging ps
docker compose -p ecoledigitale-staging logs --tail=100 ecoledigitale-api
curl -s https://staging-ecoledigitale.allianceconsultants.net/health
```
