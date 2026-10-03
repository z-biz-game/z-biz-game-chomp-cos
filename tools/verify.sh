#!/usr/bin/env bash
# One-shot acceptance gate: the node suites first, then a real browser against a real server,
# driven over CDP. Everything this script starts is killed on exit, including the Chrome it
# launched in a temp profile.
#
# PORTS ARE 5201 / 9361 ON PURPOSE AND MAY NOT COLLIDE: sibling repos in this farm hold
# 5180/9340 (gridlock), 5181/9341 (nine-rings), 5191/9351 (tango). Only ONE headless Chrome may
# bind a remote-debugging-port on this machine at a time, and an orphan from a killed agent
# squats the port and turns a browser run into a false "0 rows" verdict — so this script refuses
# to start until the coast is clear. Override with CDP_PORT= / WEB_PORT= if a sibling moved.
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates the cores and, with no CDP client attached, the process does not exit
# on its own. This game is plain 2D canvas; default headless is enough.
#
#   ./tools/verify.sh                        # node suites + 文档闸 + 破坏试验台账，然后浏览器五场景
#   LOGIC_ONLY=1 ./tools/verify.sh           # 只有 node 那一腿（不碰 Chrome、不占端口）
#   SKIP_UNIT=1 ./tools/verify.sh            # browser only (what ci.yml's browser job runs)
#   SKIP_SABOTAGE=1 ./tools/verify.sh        # 跳过台账（它要干净的工作树，改文档改到一半时用这个）
#   SCENARIOS="pointer" ./tools/verify.sh    # one suite while editing the view
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP_PORT=${CDP_PORT:-9361}
WEB_PORT=${WEB_PORT:-5201}
BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}
SHOTS=${SHOTS_DIR:-/tmp/chomp-shots}
CHROME=${CHROME_BIN:-}
# The logic tier has a floor of its own: `tools/doctest.mjs` compares this number against the
# assertion counts it measures by actually running every suite, so lowering the floor is a change
# the documentation gate notices. Suites only ever get added, never silently dropped.
MIN_LOGIC_ROWS=${MIN_LOGIC_ROWS:-171}
# Re-pin of the documentation gate's own self-count (EXPECT_ROWS inside tools/doctest.mjs): a gate
# that quietly loses an assertion must not be able to exit 0. Change one, change both.
DOCTEST_ROWS_WANT=${DOCTEST_ROWS_WANT:-367}
# The sabotage ledger's knives: one per gate group, each must drive the doc gate red AND name the
# assertion it killed. Fewer knives printed than this = a knife was deleted, which is a red, not a
# faster run. The ledger writes its measured rc back into README.md, so it only runs on a clean tree.
SABOTAGE_KNIVES_WANT=${SABOTAGE_KNIVES_WANT:-14}

# ---- logic tier first: the node suites and the documentation gate, both counted ---------------
# With LOGIC_ONLY=1 this is the whole run — no Chrome, no ports, nothing to collide with. CI's
# unit job reaches the same code by calling `node tools/doctest.mjs` directly; the browser job
# below sets SKIP_UNIT=1 and gets the browser tier on top.
cd "$HERE"
FAILED=0
LOGIC=0
echo "=== node suites ==="
# SKIP_UNIT=1 for the browser job in CI: the suites are their own job there.
if [ -z "${SKIP_UNIT:-}" ]; then
  for f in test/*.test.mjs; do
    echo "--- $f"
    OUT=$(node "$f" 2>&1) || FAILED=1
    printf '%s\n' "$OUT"
    N=$(printf '%s\n' "$OUT" | grep '^rows: ' | tail -1 | awk '{print $2}')
    LOGIC=$((LOGIC + ${N:-0}))
  done
  echo "logic assertions counted: $LOGIC (floor $MIN_LOGIC_ROWS)"
  [ "$LOGIC" -ge "$MIN_LOGIC_ROWS" ] || { echo "too few logic assertions" >&2; FAILED=1; }
  # The documentation gate: every number printed into README / DESIGN / deliverable is compared
  # against the value the code reports right now. Pure node, no browser, so it lives in the logic
  # tier — and it reads the docs, so it runs the same way locally and in CI (`node tools/doctest.mjs`).
  echo "=== doc numbers ==="
  DOCS_LOG=$HERE/../_tmp-chomp-doctest.log
  DOCS=$(node tools/doctest.mjs 2>&1); DOCS_RC=$?
  # The gate's own rc goes into the artifact and is read back: `printf`/`cat` below would otherwise
  # be the last command and their 0 would look like the gate's 0.
  printf '%s\nRC=%s\n' "$DOCS" "$DOCS_RC" > "$DOCS_LOG"
  printf '%s\n' "$DOCS"
  DOCS_RC_READ=$(tail -1 "$DOCS_LOG" | tr -d 'RC=')
  DOCS_ROWS=$(printf '%s\n' "$DOCS" | grep '^rows: ' | tail -1 | awk '{print $2}')
  echo "doc-number assertions counted: $DOCS_ROWS (pinned DOCTEST_ROWS_WANT=$DOCTEST_ROWS_WANT, rc $DOCS_RC_READ read back from $DOCS_LOG)"
  [ "$DOCS_RC_READ" = "$DOCS_RC" ] || { echo "doc gate rc 与工件里读回来的不是同一个数" >&2; FAILED=1; }
  [ "$DOCS_RC" -eq 0 ] || FAILED=1
  [ "${DOCS_ROWS:-x}" = "$DOCTEST_ROWS_WANT" ] || { echo "doc gate 交了 ${DOCS_ROWS:-?} 条，钉的是 $DOCTEST_ROWS_WANT 条" >&2; FAILED=1; }
  # The sabotage ledger, wired the same way: rc captured, count pinned, log kept. It cuts each knife
  # into a throwaway copy of the tree (never the repo), so nothing here is restored by git — and it
  # stamps the measured rc into README.md, so a run that changes the tree is a run to look at.
  if [ -z "${SKIP_SABOTAGE:-}" ]; then
    echo "=== sabotage ledger ==="
    SAB_LOG=$HERE/../_tmp-chomp-sabotage.log
    SAB=$(node tools/sabotage.mjs 2>&1); SAB_RC=$?
    printf '%s\nRC=%s\n' "$SAB" "$SAB_RC" > "$SAB_LOG"
    printf '%s\n' "$SAB"
    SAB_RC_READ=$(tail -1 "$SAB_LOG" | tr -d 'RC=')
    KNIVES=$(printf '%s\n' "$SAB" | grep -c '^  红得住 ')
    echo "knives proven red and named: $KNIVES (pinned SABOTAGE_KNIVES_WANT=$SABOTAGE_KNIVES_WANT, rc $SAB_RC_READ read back from $SAB_LOG)"
    [ "$SAB_RC_READ" = "$SAB_RC" ] || { echo "台账 rc 与工件里读回来的不是同一个数" >&2; FAILED=1; }
    [ "$SAB_RC" -eq 0 ] || { echo "台账 rc=$SAB_RC（脏树会被它自己拒掉：git status 干净才许跑）" >&2; FAILED=1; }
    [ "$KNIVES" -eq "$SABOTAGE_KNIVES_WANT" ] || { echo "台账只点红 $KNIVES 把，钉的是 $SABOTAGE_KNIVES_WANT 把" >&2; FAILED=1; }
    # 幂等：台账回写只动 README 的 rc 末列，同一个数就该一字不改。树上多了东西 = 这一版台账不可重复。
    git -C "$HERE" status --porcelain | grep -E ' README\.md$' >/dev/null \
      && { echo "台账把 README 改脏了（第二次跑应当一字不动）" >&2; FAILED=1; }
  fi
fi
if [ -n "${LOGIC_ONLY:-}" ]; then
  [ $FAILED -eq 0 ] && echo "=== LOGIC GREEN ===" || echo "=== LOGIC FAILURES ABOVE ==="
  exit $FAILED
fi

# ---- pre-flight: no other agent's Chrome may be squatting our debug port -------------------
if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "devtools port :$CDP_PORT is already LISTENING — an orphan Chrome from another builder." >&2
  pgrep -fl remote-debugging-port >&2 || true
  exit 6
fi
if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "web port :$WEB_PORT is already LISTENING — pick WEB_PORT." >&2
  exit 7
fi
ORPHANS=$(pgrep -fl "remote-debugging-port" 2>/dev/null | grep -v "$$" | wc -l | tr -d ' ')
if [ "${ORPHANS}" != "0" ] && [ -z "${ALLOW_ORPHAN_CHROME:-}" ]; then
  echo "$ORPHANS headless Chrome(s) with a remote-debugging-port are already running on this" >&2
  echo "machine. One at a time is the rule; verify that they are yours, then set" >&2
  echo "ALLOW_ORPHAN_CHROME=1 CDP_PORT=<free port> to proceed." >&2
  pgrep -fl remote-debugging-port >&2 || true
  exit 8
fi

if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }
mkdir -p "$SHOTS"

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir=$UDD \
  --window-size=1040,860 --no-first-run --no-default-browser-check about:blank >"$SHOTS/chrome.log" 2>&1 &
CPID=$!
node "$HERE/server.cjs" $WEB_PORT >"$SHOTS/server.log" 2>&1 &
SPID=$!
cleanup() {
  kill -9 $CPID $SPID 2>/dev/null
  # wait on every background pid: without this the shell prints a shower of `Killed: 9` after
  # the verdict, which reads like a failure to whoever is scrolling the log.
  wait $CPID 2>/dev/null
  wait $SPID 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# Watchdog redirects its fds: a background subshell inherits the script's stdout, and if this ran
# inside a pipeline it would hold the write end open for the full timeout and stall the consumer
# long after the tests finished.
( sleep ${WD_TIMEOUT:-420}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools noticeably later than a warm profile; poll the
# endpoints, never guess a sleep. BOTH endpoints: devtools AND the web root.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP_PORT" >&2; exit 3; }
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || {
  echo "static server never answered on $BASE" >&2; exit 4; }

export CDP_PORT
export BASE_URL=$BASE
node tools/playtest.mjs open "$BASE" | head -3
# js/data/lots.js ships the whole 419-position book plus the campaign and the shell resolves a
# route before it reports a state, so wait on window.chomp.state.id rather than on a timer.
BOOT=""
for i in $(seq 1 80); do
  BOOT=$(node tools/playtest.mjs eval "window.chomp?window.chomp.state.id:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot lot: $BOOT"
[ "$BOOT" = "nope" ] && { echo "window.chomp never appeared at $BASE" >&2; exit 5; }
node tools/playtest.mjs shot "$SHOTS/boot.png" >/dev/null 2>&1

for s in ${SCENARIOS:-boot play routes save pointer}; do
  echo "=== @$s ==="
  OUT=$(node tools/playtest.mjs eval "@$s" nonav 2>&1)
  # The result JSON is cut out of the console by BRACE COUNTING, not JSON.parse of a whole line:
  # headless appends other text to the same line and a parse-everything reader dies on it.
  printf '%s\n' "$OUT" | python3 -c '
import sys, json
raw = sys.stdin.read()
start = raw.find("{")
if start < 0:
    print("NO RESULT", raw[-300:]); sys.exit(1)
depth = 0
for i in range(start, len(raw)):
    if raw[i] == "{": depth += 1
    elif raw[i] == "}":
        depth -= 1
        if depth == 0:
            try: d = json.loads(raw[start:i + 1])
            except Exception as e:
                print("BAD JSON", e, raw[start:start+200]); sys.exit(1)
            break
rows = d.get("rows", [])
print("rows:", len(rows), "fail:", d.get("fail"))
for r in rows:
    if not r["pass"]: print("  FAIL", r["test"], json.dumps(r["detail"], ensure_ascii=False)[:300])
sys.exit(1 if d.get("fail") else 0)
' || FAILED=1
  # A clean console is part of the contract: a thrown page error, a refused resource or a
  # rendering warning all count, even when every assertion above happened to pass.
  if printf '%s' "$OUT" | grep -qE '\[EXCEPTION\]|\[log:error\]|\[error\]|\[warning\]'; then
    echo "  CONSOLE NOT CLEAN for @$s"
    printf '%s\n' "$OUT" | grep -E '\[EXCEPTION\]|\[log:error\]|\[error\]|\[warning\]' | head -5
    FAILED=1
  fi
  node tools/playtest.mjs shot "$SHOTS/$s.png" >/dev/null 2>&1
done

# The win-state screenshot: drive one certified line, then grab the board with the card up.
# (None of the suites above ends on a solved board — they all finish on reset or a loss card.)
echo "=== win shot ==="
node tools/playtest.mjs eval "(async () => {
  const c = window.chomp;
  c.store.reset(); c.load('#/lot/shoal-01');
  await new Promise((r) => setTimeout(r, 200));
  const w = c.autoWin();
  await new Promise((r2) => setTimeout(r2, 300));
  return { won: c.state.won, plies: c.state.plies, stars: document.getElementById('stars').textContent, verdict: document.getElementById('verdict').textContent };
})()" nonav | tail -6
node tools/playtest.mjs shot "$SHOTS/win.png" >/dev/null 2>&1

echo "=== console ==="
CONS=$(node tools/playtest.mjs logs)
echo "$CONS"
echo "$CONS" | grep -qE "\[(error|EXCEPTION|log:error)\]" && { echo "console has errors" >&2; FAILED=1; }

kill $WD 2>/dev/null
wait $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
