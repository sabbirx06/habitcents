# Hosted HabitCents

The primary deployment is now [the Singapore VPS](vps.md). Keep this alwaysdata deployment as a fallback; Android's configured origin is now the DuckDNS hostname.

Website: https://habitcents.alwaysdata.net

- SSH: `habitcents@ssh-habitcents.alwaysdata.net`
- Application directory: `/home/habitcents/www/habitcents`
- Website type: Node.js 24
- Command: `node /home/habitcents/www/habitcents/server.js`
- Dashboard working directory: `www/habitcents` (the account home is prefixed automatically)
- Server binds the provider's `IP` and `PORT` environment variables.
- Database: existing Supabase PostgreSQL, with verified TLS.
- Production configuration: protected `.env` in the application directory; CA certificate in `cert/database-ca.pem`. Never commit either file or overwrite the production session secret during routine updates.

Deploy source updates to the application directory, run `npm ci --omit=dev` if dependencies change, and restart the site from Web > Sites. UI assets and templates are served from this deployment to browsers and Android. Do not upload Windows node_modules, local demo data or Android build outputs.

On 2026-10-29, HTTPS returned 200. Read-only checks confirmed recurrence, workspace, universal streak, session and budget-addition storage. Production login and data mutations have not been tested; the recent UI changes remain untested at the user's request.

Android defaults to the hosted origin. A build using that URL can operate without a local server or wireless debugging. Signing and store distribution remain separate release steps.
