# Server deployment

- Host: `heyyo@148.66.155.141`
- Checkout: `/var/www/heyyo`, branch `main`
- Git remote: `git@github-heyyo:whaleshi/heyyo.git` (server SSH alias selects the read-only deploy key)
- Canonical site: `https://heyyo.club`. HTTP on both domains and HTTPS on `www.heyyo.club` redirect with 301 to the canonical domain, preserving path/query.
- Let's Encrypt certificate covers both domains. `certbot.timer` handles renewal; `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx` reloads Nginx after renewal.
- Domain Nginx configuration: `/etc/nginx/sites-available/heyyo-domain`. IP-only HTTP access remains available.
- Frontend: Nginx serves `dist`; `/api/` proxies to `127.0.0.1:8787`.
- Processes: `heyyo-api.service` and `heyyo-indexer.service`, running as `heyyo`, enabled at boot with restart-on-failure.
- PostgreSQL: local port 5432, dedicated `heyyo_indexer` database.
- Secrets: `/home/heyyo/.config/heyyo/indexer.env`, permission 0600. This includes the server-specific database URL and Heyyo Pinata JWT. Never commit it.
- Public build configuration: `/var/www/heyyo/.env.local`, ignored by Git.
- Chain: Arc 5042, Agent `0xf27caE48838df561E6a4E68d98E2539e9C135c25`, scan start 21221144, zero confirmations.

## Updating from Git

Commit and push locally first. On the server:

```sh
cd /var/www/heyyo
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
set -a
. /home/heyyo/.config/heyyo/indexer.env
set +a
pnpm indexer:migrate
sudo systemctl restart heyyo-api heyyo-indexer
```

Inspect status with `systemctl status heyyo-api heyyo-indexer nginx` and logs with `journalctl -u heyyo-indexer -n 50`. The API stays unavailable until the first index batch commits. No trading script is executed and no wallet private key is uploaded.

Indexer RPCs: `https://rpc.mainnet.arc.io,https://arc.drpc.org/`, with failover/retries and paced requests. Confirmation count is 0 and idle polling is 1 second. Metadata enrichment runs independently so RPC failures cannot starve image updates. Homepage refresh interval is 3 seconds.
