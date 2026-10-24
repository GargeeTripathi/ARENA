#!/usr/bin/env bash
# Put this machine's backend behind a Cloudflare quick tunnel and point rag-autopsy.vercel.app at it.
# Run from the repo root with the backend already running on :8000:
#     bash deploy/go-live.sh
# Keep the window open: closing it stops the tunnel (the site then shows "backend offline"; the demo still works).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF="${CLOUDFLARED:-/d/HYPNEXIS/tools/cloudflared.exe}"
SITE="$ROOT/deploy/.site"          # holds .vercel (the link to the Vercel project); gitignored
LOG="$(mktemp)"

curl -sf http://localhost:8000/api/health >/dev/null || { echo "Start the backend first (uvicorn on :8000)."; exit 1; }

"$CF" tunnel --no-autoupdate --url http://localhost:8000 >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

echo "Starting tunnel..."
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "Tunnel did not start:"; cat "$LOG"; exit 1; }
for _ in $(seq 1 30); do curl -sf "$URL/api/health" >/dev/null && break; sleep 2; done
echo "Tunnel: $URL"

(cd "$ROOT/web" && VITE_STATIC=1 npm run build >/dev/null)
find "$SITE" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
cp -r "$ROOT/web/dist/." "$SITE/"
printf '{"api": "%s"}\n' "$URL" >"$SITE/backend.json"
(cd "$SITE" && npx --yes vercel@latest deploy --prod --yes >/dev/null)

echo "Live: https://rag-autopsy.vercel.app  ->  backend $URL"
echo "Leave this window open while people use the site. Ctrl+C to stop."
wait $TUNNEL_PID
