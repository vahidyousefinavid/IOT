#!/usr/bin/env sh
# Prints fresh random secrets in .env format. Never commit the output.
set -eu
rand() { openssl rand -base64 "$1" | tr -d '\n'; }
alnum() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }

echo "POSTGRES_PASSWORD=$(alnum 32)"
echo "REDIS_PASSWORD=$(alnum 32)"
echo "MQTT_CORE_PASSWORD=$(alnum 40)"
echo "INTERNAL_TOKEN=$(alnum 48)"
echo "EMQX_DASHBOARD_PASSWORD=$(alnum 24)"
echo "EMQX_COOKIE=$(alnum 40)"
echo "JWT_ED25519_SEED=$(rand 32)"
echo "DEVICE_PEPPER=$(rand 32)"
