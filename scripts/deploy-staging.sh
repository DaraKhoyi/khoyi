#!/usr/bin/env bash
# Deploy the current source to STAGING: https://darakhoyi.github.io/khoyi-staging/
# Staging shares the LIVE Supabase backend — it is a preview of new CODE against
# real data, NOT a data sandbox. Test here before promoting to production.
# Requires env: GITHUB_PAT, REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GITHUB_PAT:?}"; : "${REACT_APP_SUPABASE_URL:?}"; : "${REACT_APP_SUPABASE_ANON_KEY:?}"
rm -rf build node_modules/.vite
GENERATE_SOURCEMAP=false CI=false npx vite build --base=/khoyi-staging/
rm -f build/CNAME
cp build/index.html build/404.html
python3 - <<'PY'
b='<div style="position:fixed;bottom:8px;left:8px;z-index:99999;background:#9A8038;color:#0d0f14;font:700 10px system-ui;padding:3px 9px;border-radius:6px;letter-spacing:.08em;box-shadow:0 2px 10px rgba(0,0,0,.5)">STAGING</div>'
for fn in ['build/index.html','build/404.html']:
    s=open(fn).read().replace('<body>','<body>'+b,1); open(fn,'w').write(s)
PY
( cd build && rm -rf .git && git init -q && git checkout -q -b gh-pages \
  && git config user.email "dara@brokerdara.com" && git config user.name "Dara Khoyi" \
  && touch .nojekyll && git add -A && git commit -q -m "staging build $(date -u +%FT%TZ)" \
  && git push -q -f "https://$GITHUB_PAT@github.com/DaraKhoyi/khoyi-staging.git" gh-pages && rm -rf .git )
curl -s -X POST "https://api.github.com/repos/DaraKhoyi/khoyi-staging/pages/builds" -H "Authorization: Bearer $GITHUB_PAT" -H "Accept: application/vnd.github+json" >/dev/null || true
echo "→ staging: https://darakhoyi.github.io/khoyi-staging/  (allow ~1 min; rebuild for prod before promoting)"
