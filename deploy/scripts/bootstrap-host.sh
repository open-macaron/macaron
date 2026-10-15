#!/usr/bin/env bash
# Prepares a Fedora VPS to run macaron-bot's controller (docs/DEPLOYMENT.md §3).
# Idempotent: safe to run again. Run ON THE VPS as root:  sudo bash bootstrap-host.sh
#
# What it does, in order:
#   1. packages: firewalld, fail2ban, automatic security updates, podman, git
#   2. SSH hardening drop-in (keys only, no root, AllowUsers)
#   3. firewall: inbound SSH (custom port), HTTP, HTTPS only — with a 5-minute automatic rollback
#   4. systemd-resolved: no LLMNR, no mDNS
#   5. automatic security updates (dnf5-automatic)
#   6. fail2ban on sshd
#   7. the `containers` user: the pool of IDs rootful `UserNS=auto` hands out, one unique range per container
#   8. egress filter for the macaron-edge bridge: outbound HTTPS only
set -euo pipefail

SSH_PORT="${SSH_PORT:-50485}"
ADMIN_USER="${ADMIN_USER:-fedora}"

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
grep -q '^ID=fedora' /etc/os-release || { echo "Fedora only" >&2; exit 1; }
[[ "$(hostname)" == vps-* ]] || { echo "refusing to run outside the VPS (hostname $(hostname))" >&2; exit 1; }

log "1. packages"
dnf -y -q install firewalld fail2ban dnf5-plugin-automatic podman git-core

log "2. SSH: keys only, no root, only ${ADMIN_USER}"
printf '%s\n' \
  "# open-macaron hardening: first match wins, so this overrides 50-cloud-init.conf" \
  "PasswordAuthentication no" \
  "KbdInteractiveAuthentication no" \
  "PermitRootLogin no" \
  "AllowUsers ${ADMIN_USER}" >/etc/ssh/sshd_config.d/00-macaron.conf
chmod 0600 /etc/ssh/sshd_config.d/00-macaron.conf
restorecon /etc/ssh/sshd_config.d/00-macaron.conf
sshd -t
systemctl reload sshd

log "3. firewall: inbound ${SSH_PORT}/tcp, http, https"
# Safety net: if this locks SSH out, the firewall is turned off again in 5 minutes.
# Cancel it once a fresh SSH login works:  systemctl stop macaron-firewall-rollback.timer
systemctl stop macaron-firewall-rollback.timer 2>/dev/null || true
systemd-run --unit=macaron-firewall-rollback --on-active=5min /usr/bin/systemctl disable --now firewalld >/dev/null
systemctl enable --now firewalld
zone="$(firewall-cmd --get-default-zone)"
firewall-cmd -q --permanent --zone="$zone" --add-port="${SSH_PORT}/tcp"
firewall-cmd -q --permanent --zone="$zone" --add-service=http
firewall-cmd -q --permanent --zone="$zone" --add-service=https
for service in $(firewall-cmd --permanent --zone="$zone" --list-services); do
  case "$service" in http | https) ;; *) firewall-cmd -q --permanent --zone="$zone" --remove-service="$service" ;; esac
done
firewall-cmd -q --reload
echo "   zone $zone: services=[$(firewall-cmd --zone="$zone" --list-services)] ports=[$(firewall-cmd --zone="$zone" --list-ports)]"
echo "   >>> open a NEW ssh session now; if it works: systemctl stop macaron-firewall-rollback.timer"

log "4. no LLMNR, no mDNS"
install -d /etc/systemd/resolved.conf.d
printf '%s\n' "[Resolve]" "LLMNR=no" "MulticastDNS=no" >/etc/systemd/resolved.conf.d/90-macaron.conf
systemctl restart systemd-resolved

log "5. automatic security updates"
printf '%s\n' \
  "[commands]" \
  "upgrade_type = security" \
  "apply_updates = yes" \
  "reboot = when-needed" \
  "reboot_command = \"shutdown -r +5 'Rebooting after security updates'\"" >/etc/dnf/automatic.conf
systemctl enable --now dnf5-automatic.timer

log "6. fail2ban on sshd"
printf '%s\n' "[sshd]" "enabled = true" "port = ${SSH_PORT}" "backend = systemd" "maxretry = 5" "bantime = 1h" >/etc/fail2ban/jail.d/90-macaron.local
systemctl enable fail2ban
systemctl restart fail2ban

log "7. ID pool for rootful UserNS=auto"
# Each container gets its own, never-shared range carved out of this pool (containers-storage).
if ! id containers >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --comment "subordinate IDs for podman --userns=auto" containers
fi
grep -q '^containers:' /etc/subuid || echo 'containers:2147483647:2147483648' >>/etc/subuid
grep -q '^containers:' /etc/subgid || echo 'containers:2147483647:2147483648' >>/etc/subgid

log "8. egress for the macaron-edge network: HTTPS only"
# Containers on macaron-edge (Caddy, controller) may open outbound TCP 443 and nothing else.
# DNS goes to Podman's resolver on the bridge gateway (input, not forward). macaron-db is an
# internal network: Postgres has no route out at all.
install -d /etc/nftables
printf '%s\n' \
  'table inet macaron_egress' \
  'delete table inet macaron_egress' \
  'table inet macaron_egress {' \
  '  chain forward {' \
  '    type filter hook forward priority filter; policy accept;' \
  '    iifname != "macaron-edge" accept' \
  '    ct state established,related accept' \
  '    oifname "macaron-edge" accept' \
  '    tcp dport 443 accept' \
  '    counter reject with icmpx admin-prohibited' \
  '  }' \
  '}' >/etc/nftables/macaron-egress.nft
printf '%s\n' \
  "[Unit]" \
  "Description=Egress filter for macaron containers" \
  "After=nftables.service firewalld.service" \
  "" \
  "[Service]" \
  "Type=oneshot" \
  "RemainAfterExit=yes" \
  "ExecStart=/usr/sbin/nft -f /etc/nftables/macaron-egress.nft" \
  "ExecStop=/usr/sbin/nft delete table inet macaron_egress" \
  "" \
  "[Install]" \
  "WantedBy=multi-user.target" >/etc/systemd/system/macaron-egress.service
systemctl daemon-reload
systemctl enable macaron-egress.service
systemctl restart macaron-egress.service

log "done"
echo "Remaining by hand: confirm a fresh SSH login, then stop the firewall rollback timer."
