#!/usr/bin/env bash
# Fetches forge-std into contracts/lib (not committed). Run once before `forge build` / `forge test`.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib
if [ ! -d lib/forge-std/src ]; then
  curl -sL https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.9.4.tar.gz | tar xz -C lib
  mv lib/forge-std-1.9.4 lib/forge-std
fi
echo "forge-std ready"
