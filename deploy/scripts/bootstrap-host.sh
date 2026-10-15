#!/usr/bin/env bash
# Prepares a Fedora VPS to run macaron-bot's controller (docs/DEPLOYMENT.md §3).
# Idempotent: safe to run again. Run as root:  sudo bash bootstrap-host.sh
#
# What it does, in order:
#   1. packages: firewalld, fail2ban, automatic security updates
#   2. SSH hardening drop-in (keys only, no root, AllowUsers) — already applied once by hand
#   3. firewall: inbound SSH (custom port), HTTP, HTTPS only — with a 5-minute automatic rollback
#   4. systemd-resolved: no LLMNR on public interfaces
#   5. automatic security updates (dnf5-automatic)
#   6. fail2ban on sshd
#   7. the `macaron` service user: rootless Podman, lingering, no SSH, no sudo
#   8. rootless ports 80/443 for Caddy
#   9. egress filter for the `macaron` user: HTTPS + DNS only
set -euo pipefail

SSH_PORT="${SSH_PORT:-50485}"
ADMIN_USER="${ADMIN_USER:-fedora}"
SERVICE_USER="macaron"

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
grep -q '^ID=fedora' /etc/os-release || { echo "Fedora only" >&2; exit 1; }

log "1. packages"
dnf -y -q install firewalld fail2ban dnf5-plugin-automatic podman

log "2. SSH: keys only, no root, only ${ADMIN_USER}"
install -m 0600 /dev/stdin /etc/ssh/sshd_config.d/00-macaron.conf <<EOF
# open-macaron hardening — first match wins, so this overrides 50-cloud-init.conf
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers ${ADMIN_USER}
EOF
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

log "4. no LLMNR"
install -d /etc/systemd/resolved.conf.d
install -m 0644 /dev/stdin /etc/systemd/resolved.conf.d/90-macaron.conf <<'EOF'
[Resolve]
LLMNR=no
MulticastDNS=no
EOF
systemctl restart systemd-resolved

log "5. automatic security updates"
install -d /etc/dnf
install -m 0644 /dev/stdin /etc/dnf/automatic.conf <<'EOF'
[commands]
upgrade_type = security
apply_updates = yes
reboot = when-needed
reboot_command = "shutdown -r +5 'Rebooting after security updates'"
EOF
systemctl enable --now dnf5-automatic.timer

log "6. fail2ban on sshd"
install -m 0644 /dev/stdin /etc/fail2ban/jail.d/90-macaron.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
backend = systemd
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "7. service user ${SERVICE_USER}"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "macaron-bot controller (rootless podman)" "$SERVICE_USER"
fi
passwd -l "$SERVICE_USER" >/dev/null # no password: reachable only through `sudo -iu macaron`
grep -q "^${SERVICE_USER}:" /etc/subuid || usermod --add-subuids 200000-265535 "$SERVICE_USER"
grep -q "^${SERVICE_USER}:" /etc/subgid || usermod --add-subgids 200000-265535 "$SERVICE_USER"
loginctl enable-linger "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "/home/${SERVICE_USER}/.config" "/home/${SERVICE_USER}/.config/macaron" "/home/${SERVICE_USER}/.config/containers/systemd"

log "8. rootless Caddy may bind 80/443"
install -m 0644 /dev/stdin /etc/sysctl.d/90-macaron.conf <<'EOF'
net.ipv4.ip_unprivileged_port_start = 80
EOF
sysctl -q --system

log "9. egress for ${SERVICE_USER}: HTTPS and DNS only"
# Rootless containers send their traffic as the service user (pasta), so this covers them too.
install -d /etc/nftables
install -m 0644 /dev/stdin /etc/nftables/macaron-egress.nft <<EOF
table inet macaron_egress
delete table inet macaron_egress
table inet macaron_egress {
  chain output {
    type filter hook output priority filter; policy accept;
    meta skuid != "${SERVICE_USER}" accept
    oifname "lo" accept
    ct state established,related accept
    tcp dport 443 accept
    udp dport 53 accept
    tcp dport 53 accept
    counter reject with icmpx admin-prohibited
  }
}
EOF
install -m 0644 /dev/stdin /etc/systemd/system/macaron-egress.service <<'EOF'
[Unit]
Description=Egress filter for the macaron service user
After=nftables.service firewalld.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/nftables/macaron-egress.nft
ExecStop=/usr/sbin/nft delete table inet macaron_egress

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now macaron-egress.service
systemctl restart macaron-egress.service

log "done"
echo "Remaining by hand: confirm a fresh SSH login, then stop the firewall rollback timer."
