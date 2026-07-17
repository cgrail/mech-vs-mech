#!/usr/bin/env bash
# ============================================================
# mech-vs-mech — Ubuntu server setup
#
# Prepares a fresh Ubuntu (22.04/24.04) box to serve this game —
# and only this game — on the public internet:
#
#   OS      apt upgrade, unattended security upgrades (auto-reboot 04:00)
#   Net     UFW: deny all inbound except rate-limited SSH and port 80
#           from Cloudflare's IP ranges only (no bypassing the proxy)
#   SSH     hardened drop-in; password auth disabled iff a key is installed
#   Jail    fail2ban on sshd
#   Kernel  conservative sysctl hardening
#   App     Node 22 (NodeSource), build under unprivileged user "mech",
#           code owned by root (service can't modify itself)
#   Run     systemd unit with a tight sandbox — read-only FS, syscall
#           filter, no capability beyond binding port 80
#   TLS     none on this box — Cloudflare (orange-cloud DNS) terminates
#           HTTPS and proxies to the origin over plain HTTP on port 80
#
# Usage — run ON the server, from a checkout of this repo:
#
#   git clone <repo> && cd mech-vs-mech
#   sudo ./install.sh
#
# In Cloudflare: proxy the DNS record (orange cloud), set SSL mode to
# "Flexible" (the origin speaks HTTP), and leave WebSockets enabled.
# Re-running the script is safe: it re-syncs the code, rebuilds,
# restarts, and refreshes the Cloudflare IP rules. It also installs a
# systemd timer that runs update.sh every 5 minutes, auto-deploying
# whatever lands on origin/main.
#
# Testing around Cloudflare (http://<server-ip>/ directly):
#
#   sudo ./install.sh test-on 203.0.113.7   # open port 80 to one address
#   sudo ./install.sh test-on               # …or to everyone (avoid)
#   sudo ./install.sh test-off              # back to Cloudflare-only
#
# Tunables (README "Deploying to the Internet") live in
# /etc/default/mech-vs-mech and survive re-runs.
# ============================================================
set -euo pipefail

APP_DIR=/opt/mech-vs-mech
APP_USER=mech
APP_HOME=/var/lib/mech-vs-mech
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- preflight ----------
[[ $EUID -eq 0 ]] || die "run with sudo: sudo ./install.sh"

# ---------- test-mode subcommands (skip the full install) ----------
case "${1:-}" in
  test-on)
    if [[ -n ${2:-} ]]; then
      ufw allow from "$2" to any port 80 proto tcp comment 'TESTING'
      echo "port 80 open to $2 (past Cloudflare) — close with: sudo ./install.sh test-off"
    else
      ufw allow 80/tcp comment 'TESTING'
      warn "port 80 open to EVERYONE — close with: sudo ./install.sh test-off"
    fi
    exit 0 ;;
  test-off)
    # delete every rule tagged TESTING, highest rule number first
    while read -r num; do
      ufw --force delete "$num"
    done < <(ufw status numbered | grep -F TESTING | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
    echo "testing rules removed — port 80 is Cloudflare-only again"
    exit 0 ;;
  '') ;; # no subcommand → full install below
  *) die "usage: sudo ./install.sh [test-on [ip] | test-off]" ;;
esac

[[ -f $SRC_DIR/package.json && -f $SRC_DIR/server/server.js ]] \
  || die "run this script from a checkout of the mech-vs-mech repo"
grep -qi ubuntu /etc/os-release || warn "this doesn't look like Ubuntu — continuing anyway"

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ---------- base system ----------
log "Updating system packages"
apt-get update -q
apt-get upgrade "${APT_OPTS[@]}" -q

log "Installing base packages"
apt-get install "${APT_OPTS[@]}" -q \
  ca-certificates curl gnupg rsync ufw fail2ban python3-systemd unattended-upgrades

log "Enabling unattended security upgrades (auto-reboot 04:00 if required)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52-mech-autoreboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades

# ---------- SSH hardening ----------
log "Hardening sshd"
# only shut the password door if a key can still get in
has_key=""
for f in /root/.ssh/authorized_keys "/home/${SUDO_USER:-}/.ssh/authorized_keys"; do
  [[ -s $f ]] && has_key=1
done
cat > /etc/ssh/sshd_config.d/10-mech-hardening.conf <<EOF
PermitRootLogin prohibit-password
${has_key:+PasswordAuthentication no}
${has_key:+KbdInteractiveAuthentication no}
PermitEmptyPasswords no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
[[ -n $has_key ]] || warn "no authorized_keys found — leaving SSH password auth ON.
    Install a key (ssh-copy-id) and re-run this script to disable it."
sshd -t
systemctl reload ssh 2>/dev/null || systemctl restart ssh # 24.04 socket activation

log "Enabling fail2ban (sshd jail)"
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 4

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ---------- firewall: SSH + HTTP from Cloudflare only ----------
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
log "Configuring UFW (deny inbound; allow ${SSH_PORT}/tcp rate-limited, 80 from Cloudflare)"
ufw default deny incoming
ufw default allow outgoing
ufw limit "${SSH_PORT}/tcp" comment 'SSH (rate-limited)'
# drop the wide-open web rules an earlier run may have added
ufw --force delete allow 80/tcp  > /dev/null 2>&1 || true
ufw --force delete allow 443/tcp > /dev/null 2>&1 || true
# lock port 80 to Cloudflare's published ranges so nobody can talk to
# the origin around the proxy (re-runs pick up newly published ranges)
CF_IPS="$(
  curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 && echo &&
  curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6 && echo
)" || CF_IPS=""
if [[ -n $CF_IPS ]]; then
  while IFS= read -r net; do
    [[ $net =~ ^[0-9a-fA-F.:]+/[0-9]+$ ]] || continue
    ufw allow from "$net" to any port 80 proto tcp comment 'HTTP (Cloudflare)' > /dev/null
  done <<< "$CF_IPS"
  echo "  port 80 open to $(grep -c / <<< "$CF_IPS") Cloudflare ranges"
else
  warn "could not fetch Cloudflare IP ranges — opening port 80 to everyone.
    Re-run this script later to restrict it to Cloudflare."
  ufw allow 80/tcp comment 'HTTP'
fi
ufw --force enable

# ---------- kernel ----------
log "Applying sysctl hardening"
cat > /etc/sysctl.d/90-mech-hardening.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.protected_symlinks = 1
fs.protected_hardlinks = 1
EOF
sysctl --system > /dev/null

# ---------- Node.js 22 (vite 7 needs >= 22.12) ----------
if ! command -v node > /dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  log "Installing Node.js 22 from NodeSource"
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install "${APT_OPTS[@]}" -q nodejs
fi
log "Node $(node --version) / npm $(npm --version)"

# ---------- app user + code ----------
if ! id -u "$APP_USER" > /dev/null 2>&1; then
  log "Creating system user '$APP_USER'"
  useradd --system --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

log "Syncing code to $APP_DIR and building"
install -d -m 755 "$APP_DIR"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist "$SRC_DIR/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR' && HOME='$APP_HOME' npm ci --no-audit --no-fund && HOME='$APP_HOME' npm run build"
# the service user may read the code but never write it
chown -R "root:$APP_USER" "$APP_DIR"
chmod -R g-w,o-rwx "$APP_DIR"

# ---------- systemd service (sandboxed) ----------
log "Installing systemd service"
if [[ ! -f /etc/default/mech-vs-mech ]]; then
  cat > /etc/default/mech-vs-mech <<'EOF'
# mech-vs-mech tunables — see the README's "Deploying to the Internet" table.
# Cloudflare terminates HTTPS and proxies to this port over plain HTTP;
# TRUST_PROXY makes the server take client IPs from X-Forwarded-For
# (Cloudflare appends the real client last).
PORT=80
TRUST_PROXY=1
#ALLOWED_ORIGINS=
#MAX_CLIENTS=200
#MAX_CONNS_PER_IP=8
EOF
fi
cat > /etc/systemd/system/mech-vs-mech.service <<EOF
[Unit]
Description=mech-vs-mech game server (lobby + relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-/etc/default/mech-vs-mech
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP_DIR/server/server.js
Restart=always
RestartSec=2
LimitNOFILE=65535

# resource ceilings — the server holds no state, a kill+restart is harmless
MemoryMax=512M
TasksMax=64

# sandbox: read-only everything; the only capability is binding port 80.
# (No MemoryDenyWriteExecute — the V8 JIT needs W+X pages.)
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
ProcSubset=pid
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
SystemCallArchitectures=native
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mech-vs-mech
systemctl restart mech-vs-mech

# record what's deployed so update.sh's timer doesn't redeploy it
runuser -u "$(stat -c %U "$SRC_DIR")" -- git -C "$SRC_DIR" rev-parse HEAD \
  > "$APP_HOME/deployed-rev" 2>/dev/null || true

# ---------- auto-update: track origin/main every 5 min ----------
log "Installing auto-update timer (update.sh)"
cat > /etc/systemd/system/mech-vs-mech-update.service <<EOF
[Unit]
Description=mech-vs-mech auto-update (fetch origin, rebuild, restart)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/bash $SRC_DIR/update.sh
EOF
cat > /etc/systemd/system/mech-vs-mech-update.timer <<EOF
[Unit]
Description=mech-vs-mech update check every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now mech-vs-mech-update.timer

# ---------- summary ----------
sleep 2
log "Done"
systemctl --no-pager --quiet is-active mech-vs-mech && echo "  game service : running on port 80" || warn "game service is NOT running — check: journalctl -u mech-vs-mech"
cat <<EOF

  cloudflare   : point a proxied (orange-cloud) DNS record at this server,
                 SSL mode "Flexible" (origin speaks plain HTTP),
                 WebSockets enabled (on by default)
  firewall     : $(ufw status | head -1) — port 80 reachable from Cloudflare only
  tunables     : /etc/default/mech-vs-mech   (then: systemctl restart mech-vs-mech)
  logs         : journalctl -u mech-vs-mech -f
  quick check  : curl -sI http://localhost/ | head -1   (from this box)
  updates      : auto — pushes to origin/main go live within ~5 min
                 (mech-vs-mech-update.timer → update.sh, discards local
                 edits in this checkout); manual: sudo ./update.sh --force
EOF
