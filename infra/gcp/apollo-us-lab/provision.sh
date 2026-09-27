#!/usr/bin/env bash
set -euo pipefail

project_id="${GOOGLE_CLOUD_PROJECT:-node-red-alerts}"
region="${GOOGLE_CLOUD_REGION:-us-central1}"
zone="${GOOGLE_CLOUD_ZONE:-us-central1-a}"
name=apollo-us-lab
network="$name-vpc"
subnet="$name-subnet"
runtime_sa="$name-vm@$project_id.iam.gserviceaccount.com"
v2_network=default
v2_instance=kiosk-monitoring
v2_broker_tag=v2-mqtt-broker

gcloud services enable compute.googleapis.com firestore.googleapis.com iam.googleapis.com logging.googleapis.com monitoring.googleapis.com pubsub.googleapis.com secretmanager.googleapis.com --project="$project_id"

if ! gcloud iam service-accounts describe "$runtime_sa" --project="$project_id" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$name-vm" --display-name="Apollo US lab runtime" --project="$project_id"
fi
for role in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$project_id" --member="serviceAccount:$runtime_sa" --role="$role" --condition=None --quiet >/dev/null
done
gcloud projects add-iam-policy-binding "$project_id" --member="serviceAccount:$runtime_sa" --role=roles/datastore.user \
  --condition="expression=resource.name.startsWith('projects/$project_id/databases/$name'),title=apollo_us_lab_database_only,description=Limit runtime to the isolated Apollo lab database" --quiet >/dev/null

if ! gcloud compute networks describe "$network" --project="$project_id" >/dev/null 2>&1; then
  gcloud compute networks create "$network" --subnet-mode=custom --project="$project_id"
fi
if ! gcloud compute networks subnets describe "$subnet" --region="$region" --project="$project_id" >/dev/null 2>&1; then
  gcloud compute networks subnets create "$subnet" --network="$network" --range=10.42.0.0/24 --region="$region" --enable-private-ip-google-access --project="$project_id"
fi

create_firewall() {
  local rule="$1" ranges="$2" ports="$3"
  if ! gcloud compute firewall-rules describe "$rule" --project="$project_id" >/dev/null 2>&1; then
    gcloud compute firewall-rules create "$rule" --network="$network" --direction=INGRESS --action=ALLOW --rules="$ports" --source-ranges="$ranges" --target-tags="$name" --project="$project_id"
  fi
}
create_firewall "$name-allow-iap-ssh" 35.235.240.0/20 tcp:22
create_firewall "$name-allow-https" 0.0.0.0/0 tcp:80,tcp:443

if [[ " $(gcloud compute networks peerings list --network="$network" --format='value(peerings[].name)' --project="$project_id") " != *" $name-to-v2 "* ]]; then
  gcloud compute networks peerings create "$name-to-v2" --network="$network" --peer-network="$v2_network" --project="$project_id"
fi
if [[ " $(gcloud compute networks peerings list --network="$v2_network" --format='value(peerings[].name)' --project="$project_id") " != *" v2-to-$name "* ]]; then
  gcloud compute networks peerings create "v2-to-$name" --network="$v2_network" --peer-network="$network" --project="$project_id"
fi
gcloud compute instances add-tags "$v2_instance" --zone="$zone" --tags="$v2_broker_tag" --project="$project_id" --quiet
if ! gcloud compute firewall-rules describe "$name-to-v2-mqtt" --project="$project_id" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$name-to-v2-mqtt" --network="$v2_network" --direction=INGRESS --action=ALLOW \
    --rules=tcp:1883 --source-ranges=10.42.0.0/24 --target-tags="$v2_broker_tag" --project="$project_id"
fi

if ! gcloud compute addresses describe "$name-ip" --region="$region" --project="$project_id" >/dev/null 2>&1; then
  gcloud compute addresses create "$name-ip" --region="$region" --network-tier=PREMIUM --project="$project_id"
fi
public_ip="$(gcloud compute addresses describe "$name-ip" --region="$region" --project="$project_id" --format='value(address)')"

if ! gcloud pubsub topics describe "$name-events" --project="$project_id" >/dev/null 2>&1; then
  gcloud pubsub topics create "$name-events" --project="$project_id"
fi

if ! gcloud firestore databases describe --database="$name" --project="$project_id" >/dev/null 2>&1; then
  gcloud firestore databases create --database="$name" --location="$region" --type=firestore-native --delete-protection --project="$project_id" --quiet
fi
if ! gcloud pubsub topics describe "$name-dead-letter" --project="$project_id" >/dev/null 2>&1; then
  gcloud pubsub topics create "$name-dead-letter" --project="$project_id"
fi
if ! gcloud pubsub subscriptions describe "$name-runtime" --project="$project_id" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create "$name-runtime" --topic="$name-events" --ack-deadline=60 --enable-exactly-once-delivery --enable-message-ordering --dead-letter-topic="$name-dead-letter" --max-delivery-attempts=5 --project="$project_id"
fi
if ! gcloud pubsub subscriptions describe "$name-dead-letter-retained" --project="$project_id" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create "$name-dead-letter-retained" --topic="$name-dead-letter" --message-retention-duration=7d --project="$project_id"
fi
project_number="$(gcloud projects describe "$project_id" --format='value(projectNumber)')"
pubsub_agent="service-$project_number@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud pubsub topics add-iam-policy-binding "$name-dead-letter" --member="serviceAccount:$pubsub_agent" --role=roles/pubsub.publisher --project="$project_id" --quiet >/dev/null
gcloud pubsub subscriptions add-iam-policy-binding "$name-runtime" --member="serviceAccount:$pubsub_agent" --role=roles/pubsub.subscriber --project="$project_id" --quiet >/dev/null
gcloud pubsub topics add-iam-policy-binding "$name-events" --member="serviceAccount:$runtime_sa" --role=roles/pubsub.publisher --project="$project_id" --quiet >/dev/null
gcloud pubsub subscriptions add-iam-policy-binding "$name-runtime" --member="serviceAccount:$runtime_sa" --role=roles/pubsub.subscriber --project="$project_id" --quiet >/dev/null

ensure_secret() {
  local secret_id="$1" generate_value="$2"
  if ! gcloud secrets describe "$secret_id" --project="$project_id" >/dev/null 2>&1; then
    gcloud secrets create "$secret_id" --replication-policy=automatic --project="$project_id"
  fi
  gcloud secrets add-iam-policy-binding "$secret_id" --member="serviceAccount:$runtime_sa" --role=roles/secretmanager.secretAccessor --project="$project_id" --quiet >/dev/null
  if [[ "$generate_value" == true ]] && [[ -z "$(gcloud secrets versions list "$secret_id" --filter='state=ENABLED' --format='value(name)' --limit=1 --project="$project_id")" ]]; then
    openssl rand -base64 48 | tr '+/' '-_' | tr -d '\n' | gcloud secrets versions add "$secret_id" --data-file=- --project="$project_id" >/dev/null
  fi
}
ensure_secret "$name-callback-token" true
ensure_secret "$name-internal-hmac" true
ensure_secret "$name-qr-hash-key" true
ensure_secret "$name-payter-cps-api-key" false

v2_broker_secret=BESITER_MQTT_CREDENTIALS
gcloud secrets describe "$v2_broker_secret" --project="$project_id" >/dev/null
gcloud secrets add-iam-policy-binding "$v2_broker_secret" --member="serviceAccount:$runtime_sa" --role=roles/secretmanager.secretAccessor --project="$project_id" --quiet >/dev/null

if ! gcloud compute instances describe "$name" --zone="$zone" --project="$project_id" >/dev/null 2>&1; then
  gcloud compute instances create "$name" \
    --zone="$zone" --machine-type=e2-medium --network-interface="subnet=$subnet,address=$public_ip,network-tier=PREMIUM" \
    --service-account="$runtime_sa" --scopes=https://www.googleapis.com/auth/cloud-platform \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud --boot-disk-size=30GB --boot-disk-type=pd-balanced \
    --tags="$name" --labels="app=apollo-us,environment=lab,managed-by=codex" \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE,serial-port-enable=FALSE \
    --metadata-from-file=startup-script="$(dirname "$0")/startup.sh" \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring --no-can-ip-forward \
    --maintenance-policy=MIGRATE --restart-on-failure --deletion-protection --project="$project_id"
fi

gcloud firestore fields ttls update expiresAt --collection-group=apolloRuntimeEvents --enable-ttl --database="$name" --project="$project_id" --async --quiet >/dev/null
public_host="$name.${public_ip//./-}.sslip.io"
printf 'instance=%s\nzone=%s\nstatic_ip=%s\nlab_hostname=%s\n' "$name" "$zone" "$public_ip" "$public_host"
