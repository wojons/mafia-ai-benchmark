import sqlite3
import time
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "stats-probe.db"
db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
cur = db.cursor()

t0 = time.perf_counter()
ids = [
    r[0]
    for r in cur.execute(
        "SELECT id FROM games WHERE status='ENDED' ORDER BY created_at DESC LIMIT 1000"
    )
]
t1 = time.perf_counter()

q = (
    "SELECT json_extract(data,'$.winner') FROM events WHERE game_id=? "
    "AND phase='GAME_OVER' AND json_extract(data,'$.winner') IN ('MAFIA','TOWN') "
    "ORDER BY sequence DESC LIMIT 1"
)
m = tw = 0
for gid in ids:
    row = cur.execute(q, (gid,)).fetchone()
    if row and row[0] == "MAFIA":
        m += 1
    elif row and row[0] == "TOWN":
        tw += 1
t2 = time.perf_counter()
n = len(ids)

print(f"listGames(1000)_ms={(t1 - t0) * 1000:.1f}")
print(
    f"n1_loop_ms={(t2 - t1) * 1000:.1f}  games={n}  per_game_ms={(t2 - t1) * 1000 / n:.3f}"
)
print(f"wins_derived mafia={m} town={tw}")
print("client=python3 stdlib sqlite3, copy of dump, readonly")
