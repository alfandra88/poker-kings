#!/usr/bin/env bash
#
# Poker Kings — run the whole stack on a single public port (default 44444).
#
#   ./run.sh              build if needed, then start everything
#   ./run.sh --dev        development mode (hot reload, no proxy)
#   ./run.sh --no-build   skip the build, start whatever is already built
#   ./run.sh --stop       stop a running instance
#   ./run.sh --status     show what's running
#   PORT=8080 ./run.sh    use a different public port
#   PUBLIC_IP=1.2.3.4 ./run.sh   pin the advertised address (skips detection)
#
# Layout (only the proxy listens publicly; everything else stays on localhost).
# All ports cluster around 44444 so one firewall rule / NAT map covers the
# whole stack:
#   0.0.0.0:44444  proxy  --+-- /socket.io/* -> realtime service (127.0.0.1:44447)
#                           +-- /rest/room/* -> realtime REST    (127.0.0.1:44448)
#                           +-- /*           -> Next.js standalone (127.0.0.1:44446)
#
# Override any port via env: PUBLIC_PORT / NEXT_PORT / SOCKET_PORT / REST_PORT.
# Keep scripts/proxy.mjs, src/lib/poker/store.js (XTransformPort) and
# src/app/api/room/[id]/route.js defaults in sync when changing them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ───────────── ports (single source of truth) ─────────────
# 44444 is the ONLY port exposed publicly; 44446/44447/44448 stay on localhost.
PUBLIC_PORT="${PORT:-${PUBLIC_PORT:-44444}}"
NEXT_PORT="${NEXT_PORT:-44446}"
SOCKET_PORT="${SOCKET_PORT:-44447}"
REST_PORT="${REST_PORT:-44448}"
RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

MODE="prod"
DO_BUILD=1
ACTION="run"

# ───────────────────────────── helpers ─────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not installed" >&2; exit 1; }; }

is_up() { # is_up <port>
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- && return 0 || return 1
}

wait_for() { # wait_for <port> <label> [timeout_s]
  local port="$1" label="$2" timeout="${3:-30}" i=0
  while [ $i -lt $((timeout * 4)) ]; do
    if is_up "$port"; then echo "  ok   $label (port $port)"; return 0; fi
    sleep 0.25; i=$((i + 1))
  done
  echo "  FAIL $label did not come up on port $port within ${timeout}s" >&2
  tail -20 "$LOG_DIR/$label.log" 2>/dev/null >&2 || true
  return 1
}

stop_one() {
  local name="$1" pidfile="$RUN_DIR/$1.pid"
  local pid=""
  [ -f "$pidfile" ] && pid="$(cat "$pidfile")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # kill the whole process group so any `bun run` wrappers die too
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    sleep 0.5
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    echo "  stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
}

# A pidfile can go stale (crash, reboot, manual kill). As a safety net also
# reap anything still bound to one of our processes, so a restart never
# collides with an orphaned listener.
stop_stragglers() {
  local pattern pids
  for pattern in "scripts/proxy.mjs" ".next/standalone/server.js" "mini-services/poker-service/index.js"; do
    pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
    [ -n "$pids" ] || continue
    kill -KILL $pids 2>/dev/null || true
    echo "  reaped straggler(s): $pattern"
  done
  sleep 0.5
}

stop_all() {
  echo "stopping Poker Kings…"
  for n in proxy web realtime dev; do stop_one "$n"; done
  stop_stragglers
}

show_status() {
  echo "Poker Kings status"
  for pair in "web:$NEXT_PORT" "realtime:$SOCKET_PORT" "rest:$REST_PORT" "proxy:$PUBLIC_PORT"; do
    local_name="${pair%%:*}"; port="${pair##*:}"
    if is_up "$port"; then echo "  up      $local_name (port $port)"; else echo "  down    $local_name (port $port)"; fi
  done
}

# Detect the machine's public IPv4 without depending on an internet lookup:
# use the source address the default route picks (the public NIC's own IP),
# skipping RFC1918/loopback/link-local. External lookup only as a last resort
# (NAT / multi-homed hosts).
detect_public_ip() {
  local ip=""
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}')" || true
  case "$ip" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|127.*|169.254.*) ip="" ;;
  esac
  if [ -z "$ip" ]; then
    ip="$(ip -4 -o addr show scope global 2>/dev/null \
      | grep -vE 'inet (10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)' \
      | awk '{split($4, a, "/"); print a[1]; exit}')" || true
  fi
  if [ -z "$ip" ]; then
    ip="$(curl -fsS -m 6 https://api.ipify.org 2>/dev/null)" || true
  fi
  echo "${ip:-<server-ip>}"
}

# ───────────────────────── arg dispatch (after helpers) ─────────────────────────
case "${1:-}" in
  --dev)      MODE="dev"; DO_BUILD=0 ;;
  --no-build) DO_BUILD=0 ;;
  --stop)     ACTION="stop" ;;
  --status)   ACTION="status" ;;
  --help|-h)  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "")         ;;
  *)          echo "unknown option: $1 (try --help)" >&2; exit 1 ;;
esac

case "$ACTION" in
  stop)   stop_all;   exit 0 ;;
  status) show_status; exit 0 ;;
esac

# ───────────────────────────── preflight ─────────────────────────────
need bun
# The proxy MUST run on node: Bun's http.Server does not flush WebSocket
# upgrade sockets, which breaks Socket.IO through the proxy.
need node
echo "Poker Kings — starting in $MODE mode"
echo "  ports: public=$PUBLIC_PORT next=$NEXT_PORT socket=$SOCKET_PORT rest=$REST_PORT"

for p in "$PUBLIC_PORT" "$NEXT_PORT" "$SOCKET_PORT" "$REST_PORT"; do
  if is_up "$p"; then
    echo "error: port $p is already in use." >&2
    echo "       run './run.sh --stop' first, or set PORT=<other>." >&2
    exit 1
  fi
done

# ───────────────────── realtime service (always) ─────────────────────
echo "starting realtime service…"
( cd mini-services/poker-service
  POKER_SERVICE_PORT="$SOCKET_PORT" POKER_REST_PORT="$REST_PORT" \
    exec bun index.js ) >"$LOG_DIR/realtime.log" 2>&1 &
echo $! > "$RUN_DIR/realtime.pid"
wait_for "$SOCKET_PORT" realtime 20
wait_for "$REST_PORT" realtime-rest 20

# ───────────────────── development mode short-circuit ─────────────────────
if [ "$MODE" = "dev" ]; then
  echo
  echo "dev mode — Next.js only, no proxy. Socket.IO stays on $SOCKET_PORT."
  bun run dev >"$LOG_DIR/dev.log" 2>&1 &
  echo $! > "$RUN_DIR/dev.pid"
  wait_for 3000 dev 45
  echo
  echo "  web      http://localhost:3000"
  echo "  socket   http://localhost:$SOCKET_PORT"
  echo "  logs     $LOG_DIR/dev.log"
  exit 0
fi

# ───────────────────────── build (production) ─────────────────────────
if [ "$DO_BUILD" = "1" ] || [ ! -f ".next/standalone/server.js" ]; then
  echo "building…"
  if ! bun run build >"$LOG_DIR/build.log" 2>&1; then
    echo "  FAIL build — see $LOG_DIR/build.log" >&2
    tail -30 "$LOG_DIR/build.log" >&2
    exit 1
  fi
  echo "  ok   build"
fi

# ───────────────────── Next.js standalone (internal) ─────────────────────
echo "starting web (standalone)…"
# The room proxy reaches REST over 127.0.0.1, so tell it the real REST port.
POKER_REST_PORT="$REST_PORT" \
NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$NEXT_PORT" \
  bun .next/standalone/server.js >"$LOG_DIR/web.log" 2>&1 &
echo $! > "$RUN_DIR/web.pid"
wait_for "$NEXT_PORT" web 40

# ───────────────────────── public single-port proxy ─────────────────────────
echo "starting public proxy on 0.0.0.0:$PUBLIC_PORT…"
PUBLIC_PORT="$PUBLIC_PORT" NEXT_PORT="$NEXT_PORT" \
SOCKET_PORT="$SOCKET_PORT" REST_PORT="$REST_PORT" BIND_HOST=0.0.0.0 \
  node scripts/proxy.mjs >"$LOG_DIR/proxy.log" 2>&1 &
echo $! > "$RUN_DIR/proxy.pid"
wait_for "$PUBLIC_PORT" proxy 20

# ───────────────────────── smoke check ─────────────────────────
echo
if curl -fsS -m 10 "http://127.0.0.1:$PUBLIC_PORT/" -o /dev/null 2>/dev/null; then
  echo "  ok   homepage responds through the public port"
else
  echo "  FAIL homepage did not respond" >&2
  tail -20 "$LOG_DIR/proxy.log" >&2 || true
  exit 1
fi

# Advertised address: local route detection first (no internet dependency),
# external lookup only as a fallback. Set PUBLIC_IP to pin it explicitly.
PUBLIC_IP="${PUBLIC_IP:-$(detect_public_ip)}"

cat <<EOF

  Poker Kings is live.

    Web UI    http://$PUBLIC_IP:$PUBLIC_PORT
    local     http://127.0.0.1:$PUBLIC_PORT

  Internal (localhost only):
    Next.js   127.0.0.1:$NEXT_PORT
    Socket.IO 127.0.0.1:$SOCKET_PORT
    REST      127.0.0.1:$REST_PORT

  Logs      $LOG_DIR/{proxy,web,realtime}.log
  Stop      ./run.sh --stop
  Status    ./run.sh --status

EOF