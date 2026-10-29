#!/bin/sh
if [ "$RENEWED_LINEAGE" = /etc/letsencrypt/live/habitcents.duckdns.org ]; then
    /usr/sbin/nginx -t && /usr/bin/systemctl reload nginx
fi
