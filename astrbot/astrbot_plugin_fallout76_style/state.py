"""An independent, transactional style store. Never opens the game knowledge store."""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time

from .observations import cleaned_text, features
from .profile import learn, render, validated

SCHEMA = """
CREATE TABLE scope (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope TEXT NOT NULL, salt BLOB NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL DEFAULT '', runs INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE samples (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT NOT NULL UNIQUE, speaker TEXT NOT NULL, ts INTEGER NOT NULL,
    reply TEXT NOT NULL, quoted INTEGER NOT NULL, source TEXT NOT NULL,
    fingerprint TEXT NOT NULL, features TEXT NOT NULL
);
CREATE INDEX sample_ts ON samples(ts, seq);
CREATE INDEX sample_fingerprint ON samples(fingerprint);
CREATE TABLE versions (
    id INTEGER PRIMARY KEY, at INTEGER NOT NULL, reason TEXT NOT NULL, profile TEXT NOT NULL,
    delta TEXT NOT NULL, sources TEXT NOT NULL
);
PRAGMA user_version=1;
"""
WINDOW = 240


def dump(x):
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def keyed(salt, raw):
    return hmac.new(salt, raw.encode("utf-8"), sha256).hexdigest()


class State:
    def __init__(self, path, group, platform, bots):
        self.path = Path(path)
        self.bots = frozenset(bots)
        self.scope = dump([platform, group, sorted(bots)])

    @contextmanager
    def db(self, write=False):
        if not write and not self.path.is_file():
            raise FileNotFoundError("style database does not exist")
        if write:
            # The configured parent must already exist (missing drives must not create a new store).
            if not self.path.parent.is_dir():
                raise FileNotFoundError("style data directory does not exist")
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
        uri = self.path.resolve().as_uri() + ("?mode=rw" if write else "?mode=ro")
        db = sqlite3.connect(uri, uri=True, timeout=3)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            ver = db.execute("PRAGMA user_version").fetchone()[0]
            if ver == 0 and write:
                if db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                    raise ValueError("not a Fallout 76 style database")
                for sql in SCHEMA.split(";"):
                    if sql.strip():
                        db.execute(sql)
                db.execute("INSERT INTO scope(singleton,scope,salt) VALUES(1,?,?)",
                           (self.scope, os.urandom(32)))
            elif ver != 1:
                raise ValueError("unsupported style database schema")
            scope = db.execute("SELECT * FROM scope WHERE singleton=1").fetchone()
            if not scope or scope["scope"] != self.scope:
                raise ValueError("style database belongs to a different platform, group or bot set")
            yield db, scope
            db.commit()
        finally:
            db.close()

    def ingest(self, messages):
        prepared = [(m, features(m)) for m in messages if m.sender not in self.bots]
        prepared = [(m, f) for m, f in prepared if f]
        if not prepared:
            return 0
        inserted = 0
        with self.db(write=True) as (db, scope):
            for m, f in sorted(prepared, key=lambda pair: pair[0].timestamp):
                speaker = keyed(scope["salt"], m.sender)[:20]
                signature = keyed(scope["salt"], dump([speaker, m.timestamp, cleaned_text(m.text)]))
                f["assets"] = [keyed(scope["salt"], a)[:20] for a in m.assets]
                synthetic = m.mid.startswith(("user_", "cached_", "idle_flush_"))
                if (synthetic and m.source == "gcp" and db.execute(
                        "SELECT 1 FROM samples WHERE fingerprint=?", (signature,)).fetchone()):
                    continue
                if not synthetic and m.source == "event":
                    db.execute("DELETE FROM samples WHERE source='gcp' AND fingerprint=? "
                               "AND (mid LIKE 'user\\_%' ESCAPE '\\' OR mid LIKE 'cached\\_%' ESCAPE '\\' "
                               "OR mid LIKE 'idle\\_flush\\_%' ESCAPE '\\')", (signature,))
                # An event can enrich a flattened GCP row with a real quote and image type.
                previous = db.execute("SELECT source,reply,quoted FROM samples WHERE mid=?", (m.mid,)).fetchone()
                if previous:
                    if previous["source"] == "gcp" and m.source == "event":
                        db.execute("UPDATE samples SET source=?,reply=?,quoted=?,features=?,fingerprint=? WHERE mid=?",
                                   ("event", m.reply or previous["reply"], int(m.quoted or previous["quoted"]),
                                    dump(f), signature, m.mid))
                    continue
                db.execute("INSERT INTO samples(mid,speaker,ts,reply,quoted,source,fingerprint,features) "
                           "VALUES(?,?,?,?,?,?,?,?)",
                           (m.mid, speaker, m.timestamp, m.reply, int(m.quoted), m.source, signature, dump(f)))
                inserted += 1
        return inserted

    @staticmethod
    def _latest(db):
        return db.execute("SELECT * FROM versions ORDER BY id DESC LIMIT 1").fetchone()

    def active(self):
        if not self.path.exists():
            return 0, {}
        with self.db() as (db, _):
            row = self._latest(db)
            return (row["id"], validated(json.loads(row["profile"]))) if row else (0, {})

    @staticmethod
    def _version(db, previous, current, source, reason, now):
        delta = {k: [previous.get(k), current.get(k)] for k in sorted(previous.keys() | current.keys())
                 if previous.get(k) != current.get(k)}
        return db.execute("INSERT INTO versions(at,reason,profile,delta,sources) VALUES(?,?,?,?,?)",
                          (now, reason, dump(current), dump(delta), dump(source))).lastrowid

    def evolve(self, minimum, every, daily, now=None):
        now = int(time.time()) if now is None else int(now)
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        with self.db(write=True) as (db, scope):
            if scope["paused"]:
                return "paused", 0
            used = scope["runs"] if scope["day"] == day else 0
            if used >= daily:
                return "daily_limit", 0
            top, count = db.execute("SELECT COALESCE(MAX(seq),0),COUNT(*) FROM samples WHERE seq>?",
                                    (scope["cursor"],)).fetchone()
            current = self._latest(db)
            if count < (every if current else minimum):
                return "waiting", 0
            rows = [dict(r) for r in db.execute(
                "SELECT * FROM samples ORDER BY ts DESC,seq DESC LIMIT ?", (WINDOW,))]
            for r in rows:
                r["f"] = json.loads(r["features"])
            anchors = {}
            known = {r["mid"] for r in rows}
            for r in rows:
                if r["quoted"] and r["reply"] and r["reply"] not in known and r["reply"] not in anchors:
                    parent = db.execute("SELECT mid,speaker,ts FROM samples WHERE mid=?", (r["reply"],)).fetchone()
                    if parent:
                        anchors[r["reply"]] = dict(parent)
            outcome = learn(list(reversed(rows)), minimum, anchors)
            db.execute("UPDATE scope SET cursor=?,day=?,runs=? WHERE singleton=1", (top, day, used + 1))
            if not outcome:
                return "insufficient_dialogue", 0
            candidate, sources = outcome
            previous = validated(json.loads(current["profile"])) if current else {}
            if previous == candidate:
                return "unchanged", 0
            render(candidate)
            return "applied", self._version(db, previous, candidate, sources, "learned", now)

    def status(self):
        with self.db() as (db, scope):
            current = self._latest(db)
            return {
                "samples": db.execute("SELECT COUNT(*) FROM samples").fetchone()[0],
                "cursor": scope["cursor"], "paused": bool(scope["paused"]),
                "budget": {"utc_day": scope["day"], "runs": scope["runs"]},
                "version": current["id"] if current else 0,
                "profile": validated(json.loads(current["profile"])) if current else {},
            }

    def history(self, limit=10):
        with self.db() as (db, _):
            return [{k: json.loads(r[k]) if k in ("profile", "delta", "sources") else r[k]
                     for k in r.keys()} for r in db.execute("SELECT * FROM versions ORDER BY id DESC LIMIT ?", (limit,))]

    def rollback(self, target):
        with self.db(write=True) as (db, _):
            latest = self._latest(db)
            row = db.execute("SELECT * FROM versions WHERE id=?", (target,)).fetchone()
            if target and not row:
                raise ValueError("unknown style version")
            previous = validated(json.loads(latest["profile"])) if latest else {}
            profile = validated(json.loads(row["profile"])) if row else {}
            version = self._version(db, previous, profile, json.loads(row["sources"]) if row else [],
                                    "rollback:" + str(target), int(time.time()))
            db.execute("UPDATE scope SET paused=1 WHERE singleton=1")
            return version

    def resume(self):
        with self.db(write=True) as (db, _):
            db.execute("UPDATE scope SET paused=0 WHERE singleton=1")
