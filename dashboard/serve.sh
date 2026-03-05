#!/bin/bash
# OMA Meta-Cognitive Dashboard — static file server
# Serves dashboard on port 8090
PORT=${1:-8090}
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🧙‍♂️ OMA Dashboard serving at http://$(hostname).home.mykuhlmann.com:${PORT}"
echo "   Local: http://localhost:${PORT}"
echo "   Dir: ${DIR}"
cd "$DIR"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
