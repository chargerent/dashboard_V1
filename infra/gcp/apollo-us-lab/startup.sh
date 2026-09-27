#!/usr/bin/env bash
set -euo pipefail

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
install -d -m 0755 /srv/apollo-us
