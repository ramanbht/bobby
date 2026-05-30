#!/usr/bin/env bash
# Bobby end-to-end test runner.
#
# A single command for contributors / agents: validates the codebase by running
# typecheck, the vitest suite (unit + integration with a mock adapter), the
# production build, then boots the server with a temp DB and pokes the REST +
# WebSocket protocol. Exits non-zero on any failure.
#
# Optional flags:
#   --live           also run a tiny live Claude turn (~$0.01)
#   --skip-install   skip `pnpm install` (assume node_modules is ready)
#
# Usage:  pnpm e2e            # standard
#         pnpm e2e -- --live  # include a live LLM smoke

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

LIVE=0
SKIP_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --) ;;                  # pnpm passes through a literal `--` separator
    --live) LIVE=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --help|-h)
      grep -E "^#( |$)" "$0" | sed -E "s/^#( |$)//"
      exit 0 ;;
    *) echo "unknown flag: $arg"; exit 2 ;;
  esac
done

TOTAL=0; PASSED=0; FAILED=0; FAILS=()
section() { printf "\n────── %s ──────\n" "$1"; }
ok()   { echo "  ✓ $1"; PASSED=$((PASSED+1)); TOTAL=$((TOTAL+1)); }
fail() { echo "  ✗ $1"; FAILED=$((FAILED+1)); TOTAL=$((TOTAL+1)); FAILS+=("$1"); }

# Sanity
section "Environment"
echo "  node $(node --version 2>/dev/null || echo MISSING)"
echo "  pnpm $(pnpm --version 2>/dev/null || echo MISSING)"
command -v jq >/dev/null || { echo "  ! jq is required (brew install jq)"; exit 2; }

# 1) install
if [ $SKIP_INSTALL -eq 0 ]; then
  section "Install"
  if pnpm install >/tmp/e2e-install.log 2>&1; then ok "pnpm install"
  else fail "pnpm install"; tail -15 /tmp/e2e-install.log; exit 1; fi
fi

# 2) typecheck
section "Typecheck"
if pnpm -r typecheck >/tmp/e2e-tc.log 2>&1; then ok "pnpm -r typecheck"
else fail "typecheck"; grep -E "error TS|error: " /tmp/e2e-tc.log | head -20; fi

# 3) unit + integration tests
section "Vitest (unit + integration)"
pnpm --filter @bobby/server test 2>&1 | tee /tmp/e2e-test.log | grep -E "(Test Files|Tests) " | tail -2 | sed 's/^/  /'
if grep -qE "(Test Files|Tests).*failed" /tmp/e2e-test.log; then fail "vitest"; else ok "vitest"; fi

# 4) build
section "Build"
if pnpm build >/tmp/e2e-build.log 2>&1; then ok "pnpm build"
else fail "build"; tail -20 /tmp/e2e-build.log; fi

# 5) server boot + REST + WS smoke
section "Server boot + REST + WebSocket smoke"
DB="/tmp/bobby-e2e-$$.sqlite"
PORT=8780
BOBBY_DB="$DB" PORT="$PORT" node packages/server/dist/index.js >/tmp/e2e-srv.log 2>&1 &
SRV=$!
disown $SRV 2>/dev/null || true
cleanup() { kill "$SRV" 2>/dev/null; rm -f "$DB" "$DB-shm" "$DB-wal"; }
trap cleanup EXIT INT TERM

up=0
for i in $(seq 1 40); do
  if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 0.25
done
if [ $up -eq 1 ]; then ok "server boots on :$PORT"; else fail "server boot"; tail -20 /tmp/e2e-srv.log; cleanup; exit 1; fi

# REST checks
[ "$(curl -s "http://localhost:$PORT/api/health" | jq -r .ok)" = "true" ] && ok "GET /api/health" || fail "/api/health"
[ "$(curl -s "http://localhost:$PORT/api/harnesses" | jq 'length')" = "3" ] && ok "GET /api/harnesses returns 3" || fail "harnesses"

# CRUD + harness switch via REST
CID=$(curl -s -X POST "http://localhost:$PORT/api/chats" -H 'content-type: application/json' \
  -d '{"harness":"claude","model":"sonnet","title":"e2e"}' | jq -r .id)
[ -n "$CID" ] && [ "$CID" != "null" ] && ok "POST /api/chats" || fail "create chat"
HARNESS=$(curl -s -X PATCH "http://localhost:$PORT/api/chats/$CID" -H 'content-type: application/json' \
  -d '{"harness":"hermes"}' | jq -r .harness)
[ "$HARNESS" = "hermes" ] && ok "PATCH harness (clears session + wipes pi dir)" || fail "patch harness"
BAD=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:$PORT/api/chats/$CID" \
  -H 'content-type: application/json' -d '{"harness":"bogus"}')
[ "$BAD" = "400" ] && ok "PATCH harness validates (bogus → 400)" || fail "patch validation"
curl -s -X DELETE "http://localhost:$PORT/api/chats/$CID" >/dev/null

JID=$(curl -s -X POST "http://localhost:$PORT/api/jobs" -H 'content-type: application/json' \
  -d '{"name":"e2e","harness":"claude","prompt":"x","schedule":"0 9 * * *"}' | jq -r .id)
[ -n "$JID" ] && [ "$JID" != "null" ] && ok "POST /api/jobs" || fail "create job"
BADJOB=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:$PORT/api/jobs" \
  -H 'content-type: application/json' -d '{"name":"x","harness":"claude","prompt":"x","schedule":"nope"}')
[ "$BADJOB" = "400" ] && ok "POST /api/jobs rejects bad cron" || fail "job cron validation"
curl -s -X DELETE "http://localhost:$PORT/api/jobs/$JID" >/dev/null

# WS protocol — 5 error frames + silent stop
WS_OUT=$(PORT=$PORT node --input-type=module <<'EOF' 2>&1
const ws = new WebSocket(`ws://localhost:${process.env.PORT}/ws`);
const seen = [];
ws.onopen = () => {
  ws.send("not json");
  ws.send(JSON.stringify({ type: "send", chatId: "nope", text: "hi" }));
  ws.send(JSON.stringify({ type: "edit", chatId: "nope", messageId: "x", text: "y" }));
  ws.send(JSON.stringify({ type: "plan", chatId: "nope", text: "hi" }));
  ws.send(JSON.stringify({ type: "execute-plan", chatId: "nope", messageId: "x" }));
  ws.send(JSON.stringify({ type: "continue-plan", chatId: "nope", messageId: "x" }));
  ws.send(JSON.stringify({ type: "stop", chatId: "nope" }));
};
ws.onmessage = (e) => seen.push(JSON.parse(e.data));
setTimeout(() => {
  const errors = seen.filter(f => f.type === "error").length;
  console.log("errors:" + errors);
  process.exit(errors === 6 ? 0 : 1);
}, 1500);
EOF
)
if echo "$WS_OUT" | grep -q "errors:6"; then ok "WS protocol (6 expected errors + silent stop)"
else fail "WS protocol"; echo "  $WS_OUT"; fi

cleanup
trap - EXIT INT TERM

# 6) daemon CLI smoke (no actual install)
section "Daemon CLI"
if pnpm daemon:status 2>&1 | grep -qE "not installed|State"; then ok "pnpm daemon:status responds"
else fail "daemon:status"; fi

# Optional live LLM smoke
if [ $LIVE -eq 1 ]; then
  section "Live LLM smoke (~\$0.01)"
  LDB="/tmp/bobby-e2e-live-$$.sqlite"
  LPORT=8781
  BOBBY_DB="$LDB" PORT="$LPORT" node packages/server/dist/index.js >/tmp/e2e-live-srv.log 2>&1 &
  LSRV=$!
  disown "$LSRV" 2>/dev/null || true
  trap 'kill "$LSRV" 2>/dev/null; rm -f "$LDB" "$LDB-shm" "$LDB-wal"' EXIT INT TERM
  for i in $(seq 1 30); do curl -s "http://localhost:$LPORT/api/health" >/dev/null 2>&1 && break; sleep 0.3; done
  if PORT=$LPORT node scripts/e2e-live.mjs; then ok "live Claude turn streams + saves"
  else fail "live Claude turn"; fi
  kill "$LSRV" 2>/dev/null
  rm -f "$LDB" "$LDB-shm" "$LDB-wal"
  trap - EXIT INT TERM
fi

# Summary
section "Summary"
printf "  %d / %d passed, %d failed\n" "$PASSED" "$TOTAL" "$FAILED"
if [ $FAILED -gt 0 ]; then
  echo "  failures:"
  for f in "${FAILS[@]}"; do echo "    - $f"; done
  exit 1
fi
echo "  ✓ all green"
