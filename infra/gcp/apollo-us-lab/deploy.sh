#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
project_id="${GOOGLE_CLOUD_PROJECT:-node-red-alerts}"
region="${GOOGLE_CLOUD_REGION:-us-central1}"
zone="${GOOGLE_CLOUD_ZONE:-us-central1-a}"
instance=apollo-us-lab
public_ip="$(gcloud compute addresses describe "$instance-ip" --region="$region" --project="$project_id" --format='value(address)')"
public_host="$instance.${public_ip//./-}.sslip.io"
v2_mqtt_host="$(gcloud compute instances describe kiosk-monitoring --zone="$zone" --project="$project_id" --format='value(networkInterfaces[0].networkIP)')"
if [[ ! "$v2_mqtt_host" =~ ^10\. ]]; then
  echo "The existing V2 broker private address could not be resolved." >&2
  exit 1
fi
stage="/tmp/$instance-deploy"
bundle="$(mktemp -t apollo-us-lab.XXXXXX.tgz)"
trap 'rm -f "$bundle"' EXIT

tar -C "$repo_root" \
  --exclude='services/apollo-us-runtime/node_modules' \
  --exclude='services/apollo-us-runtime/.DS_Store' \
  -czf "$bundle" services/apollo-us-runtime functions/apolloProfileTemplate.mjs functions/apolloScreens.mjs infra/gcp/apollo-us-lab

gcloud compute ssh "$instance" --zone="$zone" --project="$project_id" --tunnel-through-iap --command="rm -rf '$stage' && mkdir -p '$stage'"
gcloud compute scp "$bundle" "$instance:$stage/source.tgz" --zone="$zone" --project="$project_id" --tunnel-through-iap
gcloud compute ssh "$instance" --zone="$zone" --project="$project_id" --tunnel-through-iap --command="tar -C '$stage' -xzf '$stage/source.tgz' && sudo install -d -m 0755 /srv/apollo-us/services/apollo-us-runtime /srv/apollo-us/functions /srv/apollo-us/infra/gcp/apollo-us-lab && sudo rsync -a --delete '$stage/services/apollo-us-runtime/' /srv/apollo-us/services/apollo-us-runtime/ && sudo install -m 0644 '$stage/functions/apolloProfileTemplate.mjs' '$stage/functions/apolloScreens.mjs' /srv/apollo-us/functions/ && sudo rsync -a --delete '$stage/infra/gcp/apollo-us-lab/' /srv/apollo-us/infra/gcp/apollo-us-lab/ && if ! command -v docker >/dev/null 2>&1; then sudo bash /srv/apollo-us/infra/gcp/apollo-us-lab/bootstrap-host.sh; fi && printf 'GOOGLE_CLOUD_PROJECT=%s\nPUBLIC_HOST=%s\nV2_MQTT_HOST=%s\n' '$project_id' '$public_host' '$v2_mqtt_host' | sudo tee /srv/apollo-us/infra/gcp/apollo-us-lab/.env >/dev/null && cd /srv/apollo-us/infra/gcp/apollo-us-lab && sudo docker compose --env-file .env up -d --build --remove-orphans && sudo docker compose --env-file .env run --rm runtime node src/bootstrap.js seed-template"
printf 'health_url=https://%s/healthz\nv2_mqtt_host=%s\n' "$public_host" "$v2_mqtt_host"
