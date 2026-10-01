"""
Tiny JS lint: balance of {} [] (), template literals, and basic syntactic
sanity checks (no `const const`, no obvious `function function`, etc).
Reports the first imbalance per file with line context.
"""
import os
import re
import sys

def check(path):
    with open(path, 'r', encoding='utf-8') as f:
        src = f.read()

    # Strip strings and comments so we don't count braces inside them.
    out = []
    i = 0
    n = len(src)
    in_str = None       # None / "'" / '"' / '`'
    in_line_comment = False
    in_block_comment = False
    in_regex = False

    while i < n:
        c = src[i]
        nxt = src[i+1] if i+1 < n else ''

        if in_line_comment:
            if c == '\n':
                in_line_comment = False
                out.append(c)
            i += 1; continue
        if in_block_comment:
            if c == '*' and nxt == '/':
                in_block_comment = False
                out.append('  ')
                i += 2; continue
            i += 1; continue
        if in_str == '`':
            if c == '\\':
                out.append('  '); i += 2; continue
            if c == '`':
                in_str = None
                out.append(' ')
            else:
                out.append(' ' if c != '\n' else c)
            i += 1; continue
        if in_str in ("'", '"'):
            if c == '\\':
                out.append('  '); i += 2; continue
            if c == in_str:
                in_str = None
                out.append(' ')
            else:
                out.append(' ' if c != '\n' else c)
            i += 1; continue
        # normal code
        if c == '/' and nxt == '/':
            in_line_comment = True
            i += 2; continue
        if c == '/' and nxt == '*':
            in_block_comment = True
            i += 2; continue
        if c in ("'", '"', '`'):
            in_str = c
            i += 1; continue
        out.append(c)
        i += 1

    cleaned = ''.join(out)

    pairs = {'{': '}', '[': ']', '(': ')'}
    closers = set(pairs.values())
    stack = []
    line_starts = [0]
    for idx, ch in enumerate(src):
        if ch == '\n':
            line_starts.append(idx + 1)

    def line_of(pos):
        # binary search-ish
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= pos: lo = mid
            else: hi = mid - 1
        return lo + 1

    for idx, ch in enumerate(cleaned):
        if ch in pairs:
            stack.append((ch, idx))
        elif ch in closers:
            if not stack:
                return f"  line {line_of(idx)}: stray '{ch}'"
            opener, oidx = stack.pop()
            if pairs[opener] != ch:
                return f"  line {line_of(idx)}: '{ch}' expected to close '{opener}' from line {line_of(oidx)}"

    if stack:
        opener, oidx = stack[-1]
        return f"  line {line_of(oidx)}: unclosed '{opener}' (stack depth {len(stack)})"

    # Simple regex sanity
    bad = re.search(r'\b(const|let|var|function|class)\s+(const|let|var|function|class)\b', cleaned)
    if bad:
        return f"  doubled keyword: {bad.group(0)!r}"

    # Check every `export {` has matching `}` in cleaned form
    # (the brace balancer above already did this transitively).

    return "ok"

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else r'F:\Тор(геология)\js'
    files = sorted(f for f in os.listdir(root) if f.endswith('.js'))
    failed = 0
    for f in files:
        result = check(os.path.join(root, f))
        marker = 'OK ' if result == 'ok' else 'FAIL'
        print(f"{marker}  {f:<22} {result if result != 'ok' else ''}")
        if result != 'ok':
            failed += 1
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
