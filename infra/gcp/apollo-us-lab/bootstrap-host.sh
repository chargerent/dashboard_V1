#!/usr/bin/env bash
set -euo pipefail

install_root=/srv/apollo-us

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 openssl curl rsync ca-certificates
sudo systemctl enable --now docker

sudo install -d -m 0755 "$install_root"

if ! systemctl is-active --quiet google-cloud-ops-agent; then
  work="$(mktemp -d)"
  curl -fsSL https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh -o "$work/add-agent.sh"
  sudo bash "$work/add-agent.sh" --also-install
  rm -rf "$work"
fi
