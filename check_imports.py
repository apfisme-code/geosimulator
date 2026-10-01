"""
Verify import/export consistency across modules in js/.

For each file:
  - collect `export` declarations (export const/let/function/class NAME; and
    `export { a, b }` lists)
  - collect `import { NAME, … } from './foo.js'` and check that each NAME
    is actually exported by foo.js
"""
import os
import re
import sys
from collections import defaultdict

def parse_exports(src):
    names = set()
    # export const/let/var/function/class NAME
    for m in re.finditer(r'\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)', src):
        names.add(m.group(1))
    # export { a, b as c }
    for m in re.finditer(r'\bexport\s*\{([^}]+)\}', src):
        for part in m.group(1).split(','):
            part = part.strip()
            if not part: continue
            # could be `a` or `a as b`
            mm = re.match(r'(?:([A-Za-z_$][\w$]*)\s+as\s+)?([A-Za-z_$][\w$]*)', part)
            if mm:
                names.add(mm.group(2))
    return names

def parse_imports(src):
    out = []   # list of (from_path, [names])
    for m in re.finditer(r"\bimport\s+(?:[^;]*?)\s+from\s+['\"]([^'\"]+)['\"]", src):
        clause = m.group(0)
        path = m.group(1)
        names = []
        # { a, b as c }
        for nm in re.finditer(r'\bimport\s*\{([^}]+)\}', clause):
            for part in nm.group(1).split(','):
                part = part.strip()
                if not part: continue
                mm = re.match(r'(?:([A-Za-z_$][\w$]*)\s+as\s+)?([A-Za-z_$][\w$]*)', part)
                if mm:
                    names.append(mm.group(2))
        if names:
            out.append((path, names))
    return out

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else r'F:\Тор(геология)\js'
    files = {f: open(os.path.join(root, f), 'r', encoding='utf-8').read()
             for f in sorted(os.listdir(root)) if f.endswith('.js')}

    exports = {f: parse_exports(src) for f, src in files.items()}

    problems = 0
    for f, src in files.items():
        for path, names in parse_imports(src):
            # resolve relative
            if not path.startswith('./'):
                continue
            target = os.path.normpath(os.path.join(root, path.replace('./', '')))
            target_name = os.path.basename(target)
            if target_name not in exports:
                print(f"FAIL {f}: cannot resolve import {path!r}")
                problems += 1
                continue
            available = exports[target_name]
            for nm in names:
                if nm not in available:
                    print(f"FAIL {f}: {nm!r} not exported by {target_name}")
                    problems += 1

    if problems == 0:
        print(f"All imports resolved cleanly across {len(files)} modules.")
        return 0
    print(f"\n{problems} import problem(s).")
    return 1

if __name__ == '__main__':
    sys.exit(main())
