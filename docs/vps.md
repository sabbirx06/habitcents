# HabitCents VPS deployment

URL: https://habitcents.duckdns.org

- DigitalOcean VPS: Singapore (`sgp1`), `143.198.200.114`.
- DuckDNS A record must point to that IP. No DuckDNS token is stored on the server.
- Application: `/opt/habitcents`, Node.js 22, dedicated `habitcents` system user.
- Service: `habitcents.service`; starts on boot, restarts after failure, limited to 256 MiB.
- Backend listens only on `127.0.0.1:3001`. Nginx provides public HTTPS.
- Production environment: `/etc/habitcents.env`, root-readable only. Preserve `SESSION_SECRET` during updates.
- Database CA: `/etc/habitcents/database-ca.pem`; Supabase credentials remain server-only.
- Source configuration: `deploy/habitcents.service` and `deploy/habitcents.nginx.conf`.
- Certificate renewal uses the existing Certbot timer, with the HabitCents deploy hook reloading Nginx after renewal.

Useful commands over SSH:

```sh
systemctl status habitcents
journalctl -u habitcents -n 50 --no-pager
nginx -t
```

For updates, back up the deployed source, upload the changed files, run `npm ci --omit=dev` only if dependencies change, and restart `habitcents.service`. Do not upload Windows node_modules or local demo data. Do not replace production secrets or run schema migrations as part of routine code updates.

Supabase was retained without migration. Read-only measurements on 2026-10-29: first database query 95ms; warm queries 3–4ms, compared with 1,770ms and 152–153ms from alwaysdata. These measure database round trips, not complete signed-in page loads.

The alwaysdata deployment remains available as a fallback. The DuckDNS hostname depends on that external DNS provider; a custom domain can replace it later.

HTTPS was activated on 2026-10-29 with a Let's Encrypt certificate expiring 2027-01-27. HTTP redirects to HTTPS. External login HTML response time was 160–172ms, versus about 672ms on alwaysdata. The Android debug APK was rebuilt for this hostname. Production login/data mutation flows and recent UI changes have not been tested at the user's request.

Performance follow-up: the database pool retains one established connection and allows extra connections to idle for five minutes (maximum five). Dashboard reads share only in-flight requests; writes invalidate that sharing, and completed responses are not cached. Redundant legacy habit-count subqueries were removed from the dashboard summary. Workspace focus/visibility notifications are combined over 50ms. Fonts cache for one year and images for one hour; replace cached assets under new filenames when changing their contents. JavaScript/CSS continue to revalidate so UI updates appear immediately. Desktop Expenses restores summaries/recurring, then charts, then transactions above 650px; mobile layout rules are unchanged. Application tests and visual checks remain deferred at the user's request.
