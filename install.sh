#!/usr/bin/env bash
# ============================================================
# mech-vs-mech — Ubuntu server setup
#
# Prepares a fresh Ubuntu (22.04/24.04) box to serve this game —
# and only this game — on the public internet:
#
#   OS      apt upgrade, unattended security upgrades (auto-reboot 04:00)
#   Net     UFW: deny all inbound except rate-limited SSH and the web
#           ports of the chosen TLS mode (see below)
#   SSH     hardened drop-in; password auth disabled iff a key is installed
#   Jail    fail2ban on sshd
#   Kernel  conservative sysctl hardening
#   App     Node 22 (NodeSource), build under unprivileged user "mech",
#           code owned by root (service can't modify itself)
#   Run     systemd unit with a tight sandbox — read-only FS, syscall
#           filter, no capability beyond binding its port
#
# TLS — two modes, picked by whether DOMAIN is set:
#
#   Let's Encrypt (DOMAIN set)
#           Caddy on this box terminates HTTPS with an automatically
#           issued and renewed Let's Encrypt certificate and proxies to
#           the game server on 127.0.0.1:8080. UFW opens 80 (ACME
#           challenges + redirect) and 443 to the world. Point a plain
#           UN-proxied DNS A/AAAA record at this box; EMAIL is optional
#           (Let's Encrypt expiry notices).
#
#   Cloudflare (DOMAIN empty/unset)
#           No TLS on this box — Cloudflare (orange-cloud DNS, SSL mode
#           "Flexible", WebSockets enabled) terminates HTTPS and proxies
#           to the origin over plain HTTP; UFW locks port 80 to
#           Cloudflare's IP ranges only (no bypassing the proxy).
#
# Usage — run ON the server, from a checkout of this repo:
#
#   git clone <repo> && cd mech-vs-mech
#   sudo DOMAIN=play.example.com EMAIL=you@example.com ./install.sh   # Let's Encrypt
#   sudo ./install.sh                                                 # Cloudflare
#
# DOMAIN/EMAIL are remembered in /etc/default/mech-vs-mech, so re-runs
# are plain `sudo ./install.sh`; an explicit `sudo DOMAIN= ./install.sh`
# switches an existing box back to Cloudflare mode. Re-running is safe:
# it re-syncs the code, rebuilds, restarts, and refreshes the firewall
# rules. It also installs a systemd timer that runs update.sh every
# 5 minutes, auto-deploying whatever lands on origin/main.
#
# Testing around Cloudflare (Cloudflare mode only — Let's Encrypt mode
# already serves everyone directly):
#
#   sudo ./install.sh test-on 203.0.113.7   # open port 80 to one address
#   sudo ./install.sh test-on               # …or to everyone (avoid)
#   sudo ./install.sh test-off              # back to Cloudflare-only
#
# Tunables (README "Deploying to the Internet") live in
# /etc/default/mech-vs-mech and survive re-runs.
# ============================================================
set -Eeuo pipefail # -E: the ERR trap below also fires inside functions

APP_DIR=/opt/mech-vs-mech
APP_USER=mech
APP_HOME=/var/lib/mech-vs-mech
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# set -e aborts on any failure — make sure it never does so silently
trap 'die "install.sh failed at line $LINENO: $BASH_COMMAND"' ERR

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

# ---------- TLS mode: Let's Encrypt (DOMAIN set) or Cloudflare ----------
# DOMAIN/EMAIL unset on the command line reuse what a previous run stored
# in /etc/default/mech-vs-mech; `DOMAIN=` (set but empty) explicitly
# switches back to Cloudflare mode.
DEFAULTS_FILE=/etc/default/mech-vs-mech
if [[ -z ${DOMAIN+x} && -f $DEFAULTS_FILE ]]; then
  DOMAIN="$(sed -n 's/^DOMAIN=//p' "$DEFAULTS_FILE" | tail -1)"
fi
DOMAIN="${DOMAIN-}"
if [[ -z ${EMAIL+x} && -f $DEFAULTS_FILE ]]; then
  EMAIL="$(sed -n 's/^EMAIL=//p' "$DEFAULTS_FILE" | tail -1)"
fi
EMAIL="${EMAIL-}"
if [[ -n $DOMAIN ]]; then
  [[ $DOMAIN =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
    || die "DOMAIN doesn't look like a hostname: $DOMAIN"
  [[ -z $EMAIL || $EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] \
    || die "EMAIL doesn't look like an address: $EMAIL"
  log "TLS mode: Let's Encrypt — Caddy on this box will serve https://$DOMAIN"
else
  log "TLS mode: Cloudflare — origin speaks plain HTTP on port 80"
fi

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

# ---------- firewall: SSH + the web ports of the TLS mode ----------
# `|| true`: awk's early exit can SIGPIPE sshd, and sshd -T itself can fail
# (stderr discarded) — under pipefail either would silently kill the script
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
SSH_PORT="${SSH_PORT:-22}"
log "Configuring UFW (deny inbound; allow ${SSH_PORT}/tcp rate-limited + web)"
ufw default deny incoming
ufw default allow outgoing
ufw limit "${SSH_PORT}/tcp" comment 'SSH (rate-limited)'
# delete every rule whose comment contains $1, highest rule number first
ufw_purge() {
  while read -r num; do
    ufw --force delete "$num" > /dev/null
  done < <(ufw status numbered | grep -F "$1" | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
}
# drop the wide-open web rules an earlier run may have added
ufw --force delete allow 80/tcp  > /dev/null 2>&1 || true
ufw --force delete allow 443/tcp > /dev/null 2>&1 || true
if [[ -n $DOMAIN ]]; then
  # Let's Encrypt mode: Caddy needs 80 (ACME challenges + HTTPS redirect)
  # and 443 reachable from the whole internet
  ufw_purge 'HTTP (Cloudflare)'
  ufw allow 80/tcp  comment 'HTTP (ACME + redirect)' > /dev/null
  ufw allow 443/tcp comment 'HTTPS'                  > /dev/null
  ufw allow 443/udp comment 'HTTPS (HTTP/3)'         > /dev/null
  echo "  ports 80 + 443 open to everyone (Caddy terminates TLS on this box)"
else
  # Cloudflare mode: lock port 80 to Cloudflare's published ranges so
  # nobody can talk to the origin around the proxy (re-runs pick up
  # newly published ranges)
  ufw_purge 'HTTP (ACME + redirect)'
  ufw_purge 'HTTPS'
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

# switching Let's Encrypt → Cloudflare: Caddy must release port 80
# before the game service (restarted below with PORT=80) can bind it
if [[ -z $DOMAIN ]] && systemctl is-enabled caddy > /dev/null 2>&1; then
  log "Cloudflare mode: stopping Caddy from an earlier Let's Encrypt setup"
  systemctl disable --now caddy
fi

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
if [[ ! -f $DEFAULTS_FILE ]]; then
  cat > "$DEFAULTS_FILE" <<'EOF'
# mech-vs-mech tunables — see the README's "Deploying to the Internet" table.
# PORT / HOST / TRUST_PROXY / DOMAIN / EMAIL follow the TLS mode and are
# rewritten by every install.sh run; the commented knobs are yours to set.
TRUST_PROXY=1
#ALLOWED_ORIGINS=
#MAX_CLIENTS=200
#MAX_CONNS_PER_IP=8
EOF
fi
# upsert KEY=VALUE, un-commenting a #KEY= line if that's what's there
set_tunable() {
  if grep -qE "^#?$1=" "$DEFAULTS_FILE"
  then sed -i -E "s|^#?$1=.*|$1=$2|" "$DEFAULTS_FILE"
  else echo "$1=$2" >> "$DEFAULTS_FILE"
  fi
}
# comment KEY out (value kept for reference) so it stops applying
unset_tunable() { sed -i -E "s|^($1=)|#\1|" "$DEFAULTS_FILE"; }
set_tunable TRUST_PROXY 1 # both modes proxy: client IPs come from X-Forwarded-For
if [[ -n $DOMAIN ]]; then
  GAME_PORT=8080
  set_tunable PORT 8080      # Caddy owns 80/443 …
  set_tunable HOST 127.0.0.1 # … and is the only legitimate client
  set_tunable DOMAIN "$DOMAIN"
  if [[ -n $EMAIL ]]; then set_tunable EMAIL "$EMAIL"; else unset_tunable EMAIL; fi
else
  GAME_PORT=80
  set_tunable PORT 80
  unset_tunable HOST
  unset_tunable DOMAIN # an active DOMAIN= line would flip re-runs back to Let's Encrypt
  unset_tunable EMAIL
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

# sandbox: read-only everything; the only capability is binding port 80
# (Cloudflare mode — unused but harmless on the Let's Encrypt port 8080).
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

# ---------- Caddy: HTTPS via Let's Encrypt (DOMAIN mode only) ----------
# configured after the game service so a mode switch has already moved
# the game off port 80 by the time Caddy needs it
if [[ -n $DOMAIN ]]; then
  if ! command -v caddy > /dev/null; then
    log "Installing Caddy from its official apt repo"
    install -d -m 755 /etc/apt/keyrings
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
      | gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable.gpg
    echo "deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install "${APT_OPTS[@]}" -q caddy
  fi
  log "Configuring Caddy → https://$DOMAIN (Let's Encrypt, auto-issued + auto-renewed)"
  install -d -m 755 /etc/caddy/apps # site files of other apps sharing this box
  {
    echo '# managed by mech-vs-mech install.sh — re-runs overwrite this file'
    if [[ -n $EMAIL ]]; then
      printf '{\n\temail %s\n}\n' "$EMAIL"
    fi
    cat <<EOF
$DOMAIN {
	# game server (HTTP + WebSocket /ws); Caddy adds the X-Forwarded-*
	# headers the app trusts via TRUST_PROXY=1
	reverse_proxy 127.0.0.1:8080
}

# other apps on this box (e.g. calvo) manage their own site files here
import /etc/caddy/apps/*.caddy
EOF
  } > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile > /dev/null 2>&1 \
    || die "generated /etc/caddy/Caddyfile fails validation"
  systemctl enable caddy > /dev/null 2>&1 || true
  systemctl reload-or-restart caddy
fi

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
systemctl --no-pager --quiet is-active mech-vs-mech && echo "  game service : running on port $GAME_PORT" || warn "game service is NOT running — check: journalctl -u mech-vs-mech"
if [[ -n $DOMAIN ]]; then
  systemctl --no-pager --quiet is-active caddy && echo "  caddy        : running — terminates HTTPS for https://$DOMAIN" || warn "caddy is NOT running — check: journalctl -u caddy"
  cat <<EOF

  dns          : point a plain UN-proxied A/AAAA record for $DOMAIN at this
                 box — Caddy keeps retrying issuance until it resolves here
  certificate  : Let's Encrypt via Caddy, requested at startup and renewed
                 automatically; watch issuance: journalctl -u caddy -f
  firewall     : $(ufw status | head -1) — 80/443 open; the game port (8080)
                 is loopback-only, reachable through Caddy alone
  tunables     : /etc/default/mech-vs-mech   (then: systemctl restart mech-vs-mech)
  logs         : journalctl -u mech-vs-mech -f
  quick check  : curl -sI https://$DOMAIN/ | head -1
  updates      : auto — pushes to origin/main go live within ~5 min
                 (mech-vs-mech-update.timer → update.sh, discards local
                 edits in this checkout); manual: sudo ./update.sh --force
EOF
else
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
fi
