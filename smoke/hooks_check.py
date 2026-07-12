#!/usr/bin/env python3
# Deterministic guard against React #310: no React hook may appear AFTER the
# App-shell loading/session guards (they must all run unconditionally, above the
# early returns). This is the exact class of bug that locked Dara out in v1.02.86-93.
import re, sys

src = open('src/App.js', encoding='utf-8').read()
lines = src.split('\n')

guard_idx = next((i for i, ln in enumerate(lines) if 'if (!session) return <AuthScreen' in ln), None)
if guard_idx is None:
    print('hooks-check: WARN could not locate the App-shell guard; skipping'); sys.exit(0)

# window = from the guard down to the App shell's render return
end_idx = len(lines)
for i in range(guard_idx + 1, len(lines)):
    if lines[i].startswith('  return (') or lines[i].startswith('  return <'):
        end_idx = i; break

# top-level (2-space indent) hook calls in that window are illegal
hook_re = re.compile(r'^  (const [^=]+= )?(React\.)?(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext)\(')
bad = [(i + 1, lines[i].strip()[:90]) for i in range(guard_idx + 1, end_idx) if hook_re.search(lines[i])]

if bad:
    print('hooks-check: FAIL — hook(s) placed AFTER the App-shell loading/session guard (React #310 risk):')
    for ln, txt in bad:
        print(f'    line {ln}: {txt}')
    print('    Move these above "if (loading) return" / "if (!session) return".')
    sys.exit(1)

print('hooks-check: PASS — no hooks after the App-shell guards')
sys.exit(0)
