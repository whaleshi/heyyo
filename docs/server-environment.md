# Heyyo server environment (prepared, not deployed)

Server: `heyyo@148.66.155.141`. Prepared 2026-09-17.

- Ubuntu 26.04 LTS, x86_64, approximately 4 GB RAM and 96 GB disk.
- Node.js 22.22.1, pnpm 10.33.2; git, curl, CA certificates and build-essential installed.
- PostgreSQL 16.15 from the official PGDG repository. Cluster `16/main` listens on loopback port 5432.
- Empty database `heyyo_indexer`, owned by the non-superuser login `heyyo`. Local connection verified; zero application tables.
- Server-only database URL: `/home/heyyo/.config/heyyo/database.env` (0600). Its password was generated on the server and is not copied into this project.
- Nginx 1.28.3 installed and configuration validated. Service is masked to prevent automatic activation before deployment.
- `/srv/heyyo` is an empty directory owned by `heyyo`, mode 0750.

No project code, Pinata credential, wallet key, database migration, application process or site has been deployed. SSH configuration and existing ports were preserved.

At future deployment, explicitly unmask/enable Nginx after configuring the site. Use systemd for API/indexer processes. Read database settings from the server-only file; do not reuse workstation database credentials. Domain/TLS and application environment configuration remain deployment work.

## Git deployment source

Repository: `git@github.com:whaleshi/heyyo.git`, branch `main`.
Future deployment must obtain source through Git (initial clone, then `git pull --ff-only origin main`), followed by `pnpm install --frozen-lockfile` and the build/migration/service steps. Server GitHub authentication must be configured before the first clone. Secrets and database data remain outside Git. No clone or deployment was performed during environment preparation.
