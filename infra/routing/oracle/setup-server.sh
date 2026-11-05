#!/usr/bin/env bash
# One-time setup of a fresh Oracle Cloud Ubuntu server (Ampere A1 / ARM64, Ubuntu 22.04 or 24.04) for the routing
# stack: Docker, the firewall ports Caddy needs (80, 443) and a swap file so building the Britain + Ireland map does
# not run out of memory. Run it once as the default "ubuntu" user:
#
#   bash infra/routing/oracle/setup-server.sh
#
# Then log out and back in (so "docker" works without sudo) and follow README.md from "Build the map".
set -euo pipefail

echo "== Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "== Firewall: allow HTTP and HTTPS"
# Oracle's Ubuntu images ship iptables rules that reject everything but SSH. Open 80 and 443 before that reject rule
# and keep the rules across reboots. (The VCN security list must allow them too: see README.md.)
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
for port in 80 443; do
  sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save

echo "== Swap (8 GB) for building the map"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 8G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "Done. Log out and back in, then follow README.md (Build the map)."
