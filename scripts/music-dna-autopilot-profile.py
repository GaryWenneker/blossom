#!/usr/bin/env python3
"""Run the installed local Blossom Autopilot for a single server-validated recording.

STDIN contains only the recording's ID, title, artist, year and known duration.
Never accepts executable commands or paths from the browser.
"""
import fcntl
import json
import re
import sys
from pathlib import Path

import autopilot
import blossom_bridge as bridge

MAX_INPUT = 4096


def edition_markers(title):
    normalized = autopilot.normalize(title)
    phrases = [
        "pure trance original", "pure trance", "original mix", "radio edit",
        "7inch edit", "live at trancentral", "live at the ssl",
        "live from the lost continent", "white room version", "white room",
        "stand by the jams", "solid state logik", "album version",
        "12inch mix", "extended mix", "instrumental mix", "club mix",
        "remastered", "acoustic version", "live version"
    ]
    return [phrase for phrase in phrases if autopilot.hasphrase(normalized, phrase)]


def generic_entry(profile):
    title = str(profile["title"]).strip()
    markers = edition_markers(title)
    duration_ms = profile.get("durationMs")
    if not isinstance(duration_ms, (int, float)) or not 30_000 <= duration_ms <= 3_600_000:
        return None, "held_missing_duration", "No documented duration for this exact edition; no automatic download"
    if not markers:
        return None, "held_missing_edition", "Specify an exact mix/edition before autonomous YouTube matching"
    uid = profile["id"].replace("-", "")
    slug = "99_" + uid
    base = re.sub(r"\\([^)]*\\)", " ", title)
    base = re.split(r"\\s[-–]\\s(?=live|radio|remix|original|extended)", base, flags=re.I)[0]
    core = [token for token in autopilot.normalize(base).split()
            if token not in {"the", "a", "and", "feat", "ft", "mix", "version"}]
    if not core or len(core) > 12:
        return None, "held_missing_edition", "Title is too ambiguous to identify automatically"
    entry = {
        "blossom_id": profile["id"],
        "artist": profile["artist"],
        "title": title,
        "year": int(profile.get("year") or 2026),
        "slug": slug,
        "filename": slug + ".wav",
        "edition_to_verify": ", ".join(markers),
    }
    target = int(round(duration_ms / 1000))
    tolerance = max(6, min(12, int(target * .025)))
    alternatives = ["extended", "megamix", "compilation", "remixes", "karaoke"]
    negatives = [s for s in alternatives if not any(s in p for p in markers)]
    autopilot.RULES[slug] = (target, tolerance, markers, negatives)
    autopilot.CORES["99"] = core
    old_query = autopilot.query_variants

    def with_generic(candidate):
        if candidate["slug"] != slug:
            return old_query(candidate)
        return [
            f'{entry["artist"]} {base} {markers[0]} {target // 60}:{target % 60:02d}',
            f'{entry["artist"]} {base} {markers[0]}',
            f'{entry["artist"]} {title}'
        ]

    autopilot.query_variants = with_generic
    return entry, "", ""


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise ValueError("Profile payload too large")
        p = json.loads(raw)
        uid = p.get("id")
        if not isinstance(uid, str) or not re.fullmatch(
            r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", uid):
            raise ValueError("Invalid recording ID")
        if not isinstance(p.get("artist"), str) or not isinstance(p.get("title"), str):
            raise ValueError("Missing recording metadata")
        existing = next((e for e in bridge.load_recs() if e["blossom_id"] == uid), None)
        if existing is None:
            existing, status, message = generic_entry(p)
            if existing is None:
                print("AUTOPILOT_RESULT=" + json.dumps({"status": status, "message": message}), flush=True)
                return
        bridge.RESULTS.mkdir(parents=True, exist_ok=True)
        # Share the same lock as the user's hourly background Autopilot.
        with (bridge.RESULTS / "autopilot.lock").open("a+") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('AUTOPILOT_RESULT={"status":"held_low_confidence","message":"Another Autopilot cycle is active; retry after it finishes"}', flush=True)
                return
            result = autopilot.run_one(existing, autopilot.read_state(),
                authorized_download=True, publish=True, max_results=8)
            detail = autopilot.read_state()["recordings"].get(existing["slug"], {})
            print("AUTOPILOT_RESULT=" + json.dumps({
                "status": result,
                "message": detail.get("error") or detail.get("status") or result,
            }), flush=True)
    except Exception as exc:
        print("AUTOPILOT_RESULT=" + json.dumps({
            "status": "failed", "message": str(exc)[:300]}), flush=True)


if __name__ == "__main__":
    main()
