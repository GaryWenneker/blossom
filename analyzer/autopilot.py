#!/usr/bin/env python3
"""Autonomous, confidence-gated search -> authorized acquire -> measure -> MCP.

YouTube metadata is NOT an audio fingerprint. A confident match is a probable
edition, never a cryptographically verified studio master. Unsupported tracks
are held for future retry, without asking for interactive input.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import hashlib
import os
import fcntl
import json
from pathlib import Path
import re
import time
import unicodedata

import blossom_bridge as bridge

# Historical durations are approximate, specific to the declared EDITS. For
# overlapping variants, mix text must agree; duration alone never authenticates.
RULES = {
 "01_what_time_is_love_pure_trance_1988": (425, 12, ["pure trance", "original mix", "1988 original"], ["live at trancentral", "echo", "power remix", "story", "megamix", "remixes"]),
 "02_what_time_is_love_live_1990": (233, 10, ["live at trancentral", "radio edit", "7 inch edit", "7inch edit"], ["pure trance", "echo", "power remix", "story", "america", "extended", "12 inch", "12inch"]),
 "03_3am_eternal_pure_trance_1989": (355, 14, ["pure trance", "1989 original"], ["live at the s s l", "live at ssl", "live at s s l", "remixes", "megamix"]),
 "04_3am_eternal_live_2021": (232, 9, ["live at the s s l", "live at ssl", "live at s s l", "solid state logik"], ["pure trance", "12 a side", "12 inch", "extended", "1989 original", "remixes"]),
 "05_last_train_pure_trance_1990": (405, 15, ["pure trance", "1990 original"], ["live from the lost continent", "12 inch live", "remixes", "megamix"]),
 "06_last_train_live_radio_1991": (217, 10, ["live from the lost continent", "radio edit", "7inch edit", "7 inch edit"], ["pure trance", "extended", "12 inch", "12inch", "remixes", "lp mix"]),
 "07_justified_and_ancient_white_room": (305, 13, ["white room", "black steel"], ["tammy", "stand by", "remix", "live", "megamix"]),
 "08_justified_and_ancient_tammy": (217, 10, ["stand by the jams", "tammy wynette", "7 inch edit", "7inch edit"], ["white room", "black steel", "remix", "extended", "12 inch"]),
 "09_kylie_said_to_jason": (238, 9, ["7 inch", "7inch", "7 side", "radio edit"], ["12 inch", "12inch", "trance", "extended", "remix"]),
 "10_its_grim_up_north": (244, 9, ["radio edit", "official video", "7 inch", "7inch"], ["part 1", "10 minute", "extended", "remix", "full length"]),
 "11_doctorin_the_tardis": (217, 9, ["7 inch", "7inch", "radio edit", "1988 hq"], ["12 inch", "12inch", "extended", "remix", "top of the pops"]),
 "12_america_what_time_is_love": (247, 9, ["solid state logik", "2021 edit", "2021 remaster"], ["12 inch", "12inch", "full uncensored", "1992 7", "extended", "megamix"]),
 "13_chill_out_continuous": (2700, 150, ["chill out", "1990 continuous", "full album"], ["come down dawn", "remastered sections", "preview", "making of", "documentary"]),
}
CORES = {
 "01": ["what", "time", "is", "love"], "02": ["what", "time", "is", "love"],
 "03": ["3am", "eternal"], "04": ["3am", "eternal"],
 "05": ["last", "train", "trancentral"], "06": ["last", "train", "trancentral"],
 "07": ["justified", "ancient"], "08": ["justified", "ancient"],
 "09": ["kylie", "said", "jason"], "10": ["grim", "up", "north"],
 "11": ["doctorin", "tardis"], "12": ["america", "what", "time", "love"],
 "13": ["chill", "out"]
}
OTHER_TITLES = [set(t) for t in CORES.values()]
STOP_WORDS = {"the", "is", "and", "up", "at"}


def normalize(value):
    s = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("’", "'")
    s = re.sub(r"\b3\s*[:.]?\s*a\s*[.:]?\s*m\b", "3am", s)
    s = re.sub(r"\b7\s*(?:inch|inches|\")\b", "7inch", s)
    s = re.sub(r"\b12\s*(?:inch|inches|\")\b", "12inch", s)
    s = re.sub(r"\bs\s*s\s*l\b", "ssl", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def hasphrase(text, word):
    text, word = normalize(text), normalize(word)
    return bool(re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", text))


def classify(entry, candidate):
    slug = entry["slug"]
    target, tolerance, positives, negatives = RULES[slug]
    title = normalize(candidate.get("title", ""))
    channel = normalize(candidate.get("channel", ""))
    core = CORES[slug[:2]]
    seconds = candidate.get("duration_seconds")
    reasons = []
    if not all(hasphrase(title, w) for w in core):
        return {"score": 0, "eligible": False, "reasons": ["wrong song / missing title tokens"]}
    if seconds is None or not isinstance(seconds, (int, float)) or seconds <= 0:
        return {"score": 0, "eligible": False, "reasons": ["duration absent"]}
    delta = abs(seconds - target)
    if delta > tolerance:
        return {"score": 0, "eligible": False, "reasons": [f"duration mismatch: {seconds}s instead of circa {target}s"]}
    # Protect against a 40-min compilation matching a 3-min song due to broad search.
    for negative in negatives:
        if hasphrase(title, negative):
            return {"score": 0, "eligible": False, "reasons": [f"excluded edition: {negative}"]}
    present = [p for p in positives if hasphrase(title, p)]
    # A 1991 SSL clip may run for ~3:52 too, so an SSL tag alone is
    # insufficient to establish the 2021 Solid State Logik digital edition.
    if slug in {"04_3am_eternal_live_2021", "12_america_what_time_is_love"}:
        if not any(hasphrase(title, marker) for marker in ["solid state logik", "2021"]):
            return {"score": 0, "eligible": False,
                    "reasons": ["digital reissue identity not established by metadata"]}
    if slug == "13_chill_out_continuous":
        if not ("1990" in title and any(hasphrase(title, marker) for marker in ["full album", "continuous", "original"])):
            return {"score":0, "eligible": False,
                    "reasons":["1990 original continuous album edition not established"]}
    if not present:
        return {"score": 0, "eligible": False, "reasons": ["exact mix/edition not named"]}
    # Named release year is supportive, not proof. Reject conflicting historical
    # years only if the query clearly labels the original by that other year.
    years = re.findall(r"\b(?:19[89]\d|20[012]\d)\b", title)
    conflicting = [y for y in years if int(y) not in (entry["year"], 2021) and not (entry["year"] == 2021 and int(y) == 1991)]
    if conflicting:
        return {"score": 0, "eligible": False, "reasons": ["conflicting release year: " + ", ".join(conflicting)]}
    if seconds < 600 and ("megami" in title or "compilation" in title or "non stop" in title):
        return {"score": 0, "eligible": False, "reasons": ["compilation or medley"]}
    # Official claims on unverified YouTube metadata are not definitive.
    official = channel in {"klf", "the klf", "the timelords", "the justified ancients of mu mu"}
    score = min(100, 45 + max(4, 30 - int(delta * (0.8 if target < 600 else 0.1)))
                + 22 + (5 if official else 0) + (3 if str(entry["year"]) in title else 0))
    reasons.extend([f"title core matches", f"edition tag: {present[0]}",
                    f"duration {seconds}s (expected ~{target}s, delta {delta:.0f}s)"])
    if official: reasons.append("channel label matches known artist (not verified ownership)")
    # duration strictness is required for automatic publishing
    max_delta_for_publication = 6 if target < 600 else 90
    return {"score": score, "eligible": score >= 87 and delta <= max_delta_for_publication,
            "duration_delta_seconds": delta, "edition_evidence": present[0], "reasons": reasons,
            "identity_status": "probable edition from metadata; master not authenticated"}


def query_variants(entry):
    artist = entry["artist"]
    title = entry["title"].split(" (")[0].split(" - Live")[0]
    slug = entry["slug"]
    alternatives = {
        "01": ["1988 Pure Trance 1 original mix", "KLF 004T original 7:05"],
        "02": ["1990 Live at Trancentral radio edit 3:53", "1990 live at trancentral 7inch KLF 004"],
        "03": ["1989 Pure Trance Original KLF 005T", "pure trance original 5:55"],
        "04": ["2021 Solid State Logik 1 Live At The SSL 3:52", "Live at the SSL radio version 3:52"],
        "05": ["1990 pure trance 5 original 6:45", "Pure Trance Original"],
        "06": ["1991 radio edit live from the lost continent 3:37", "live from the lost continent 7inch"],
        "07": ["White Room Black Steel album version 5:05", "1991 white room version"],
        "08": ["1991 Tammy Wynette Stand By The JAMs 7inch", "Stand by the Jams 3:37"],
        "09": ["1989 Kylie Said to Jason 7inch 3:58", "Kylie Said to Jason radio edit"],
        "10": ["1991 It's Grim Up North radio edit 4:04", "official video 1991 4:04"],
        "11": ["1988 Doctorin the Tardis 7 inch edit 3:37", "Doctorin the Tardis radio edit"],
        "12": ["2021 Solid State Logik 1 America What Time Is Love 4:07", "2021 America What Time Is Love digital edit"],
        "13": ["1990 Chill Out 45 minute uninterrupted album", "original continuous mix full album not Come Down Dawn"]
    }
    return [f"{artist} {title} {tag}" for tag in alternatives[slug[:2]]]


def metadata_search(entry, search_count=8):
    """Runs a bounded series of complementary searches; retryable and noninteractive."""
    RESULTS = bridge.RESULTS
    RESULTS.mkdir(parents=True, exist_ok=True)
    found = {}
    errors = []
    queries = query_variants(entry)
    # Never accept low quality first results; compare all collected candidates.
    for query in queries:
        try:
            cmd = ["yt-dlp", "--ignore-config", "--no-warnings", "--flat-playlist", "--skip-download",
                   "--dump-single-json", f"ytsearch{min(25, max(3, search_count))}:{query}"]
            raw = json.loads(bridge.run(cmd, timeout=100).stdout)
            for item in raw.get("entries", []):
                if not isinstance(item, dict) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(item.get("id") or "")):
                    continue
                ident = str(item["id"])
                if ident in found: continue
                row = {"video_id": ident, "url": "https://www.youtube.com/watch?v=" + ident,
                       "title": item.get("title", ""),
                       "channel": item.get("uploader") or item.get("channel") or "",
                       "duration_seconds": item.get("duration"), "query": query}
                row["decision"] = classify(entry, row)
                found[ident] = row
        except Exception as exc:
            errors.append(str(exc)[:200])
    items = sorted(found.values(), key=lambda v:(v["decision"]["score"],
        -abs((v.get("duration_seconds") or 0)-RULES[entry["slug"]][0]),
        v["video_id"]),reverse=True)
    selected = next((r for r in items if r["decision"]["eligible"]), None)
    result = {"recording": {"blossom_id": entry["blossom_id"], "title": entry["title"], "slug": entry["slug"]},
              "searched_at": bridge.now(), "queries": queries, "candidate_count": len(items),
              "candidates": items, "errors": errors,
              "selected": selected,
              "selection_result": "auto_matched_metadata" if selected else "held_low_confidence"}
    output = RESULTS / f'{entry["slug"]}_autopilot_candidates.json'
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    return result


def read_state():
    path = bridge.RESULTS / "autopilot_state.json"
    if path.is_file():
        try:
            x = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(x, dict) and isinstance(x.get("recordings"), dict): return x
        except (ValueError, OSError): pass
    return {"version": 1, "recordings": {}}


def save_state(state):
    bridge.RESULTS.mkdir(parents=True, exist_ok=True)
    path = bridge.RESULTS / "autopilot_state.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)


def record_event(state, entry, status, **details):
    state["recordings"][entry["slug"]] = {"status": status, "at": bridge.now(), **details}
    save_state(state)
    print(f"{entry['slug']}: {status}",flush=True)


def same_measured_file(entry):
    file = bridge.metrics_path(entry)
    if not file.exists(): return False
    try:
        result = json.loads(file.read_text(encoding="utf-8"))
        source = result["audio_source_provenance"]
        from audio_metrics import sha256
        path = Path(source["file"])
        return path.is_file() and sha256(path) == source["sha256"]
    except (ValueError, KeyError, OSError): return False


def published(entry, result):
    receipt = bridge.RESULTS / f'{entry["slug"]}_publish_receipt.json'
    if not receipt.is_file(): return False
    try:
        x = json.loads(receipt.read_text(encoding="utf-8"))
        return x["blossom_id"] == entry["blossom_id"] and x["sha256"] == result["audio_source_provenance"]["sha256"]
    except (ValueError, OSError, KeyError): return False


def run_one(entry, state, *, authorized_download=False, publish=False, max_results=8):
    slug = entry["slug"]
    existing = state["recordings"].get(slug, {})
    if existing.get("status") == "published" and published_receipt_for_slug(entry):
        # A receipt must match the current measured file hash and reference ID.
        try:
            previous_measurements = json.loads(bridge.metrics_path(entry).read_text(encoding="utf-8"))
            if published(entry, previous_measurements) and same_measured_file(entry):
                print(slug + ": already published; idempotent skip")
                return "already_published"
        except (ValueError, KeyError, FileNotFoundError):
            pass
    try:
        choice = metadata_search(entry, search_count=max_results)
        candidate = choice["selected"]
        if not candidate:
            record_event(state,entry,"held_low_confidence",candidate_count=len(choice["candidates"]),
                         top_matches=[{"title":x["title"],"score":x["decision"]["score"]} for x in choice["candidates"][:3]])
            return "held_low_confidence"
        if not authorized_download:
            record_event(state,entry,"awaiting_download_authorization",youtube_url=candidate["url"])
            return "awaiting_download_authorization"
        # Never trust a prior download under a different selected video.
        provenance = bridge.DOWNLOADS / slug / "provenance.json"
        wav = bridge.AUDIO / entry["filename"]
        previous = {}
        if provenance.is_file():
            try: previous = json.loads(provenance.read_text(encoding="utf-8"))
            except ValueError: pass
        if not wav.is_file() or previous.get("url") != candidate["url"]:
            wav = bridge.download_authorized(entry,candidate["url"],True)
        previous = json.loads(provenance.read_text(encoding="utf-8"))
        auto_prev = previous.get("auto_selection", {})
        if auto_prev.get("candidate_video_id") != candidate["video_id"] or not auto_prev.get("score"):
            previous["auto_selection"] = {
                "status": "metadata_match_only_not_master_fingerprint",
                "score": candidate["decision"]["score"],
                "criteria": candidate["decision"],
                "candidate_video_id": candidate["video_id"],
                "selected_at": bridge.now(),
                "note": "Machine-selected by edition label and duration; exact master NOT fingerprint-authenticated."}
            provenance.write_text(json.dumps(previous,ensure_ascii=False,indent=2),encoding="utf-8")
        if not same_measured_file(entry) or bridge.metrics_path(entry).stat().st_mtime < provenance.stat().st_mtime:
            measures = bridge.measure(entry,wav)
        else:
            measures = json.loads(bridge.metrics_path(entry).read_text(encoding="utf-8"))
        # Check actual decoded duration, not only YouTube metadata.
        runtime = measures["audio_measurements"]["duration_seconds"]
        expected, tolerance, _, _ = RULES[slug]
        if abs(runtime-expected) > tolerance:
            record_event(state,entry,"held_decode_duration_mismatch",duration=runtime,expected=expected)
            return "held_decode_duration_mismatch"
        if not publish:
            record_event(state,entry,"measured_not_published",youtube_url=candidate["url"],duration=runtime)
            return "measured_not_published"
        if published(entry,measures):
            record_event(state,entry,"published",youtube_url=candidate["url"],already_saved=True)
            return "published"
        # Publication is explicitly opt-in at a single run-level; no per-track prompt.
        # This does NOT claim that YouTube metadata authenticated a particular master.
        asyncio.run(bridge.publish(entry,confirmed=False,auto_verified=True))
        record_event(state,entry,"published",youtube_url=candidate["url"],bpm=measures["audio_measurements"]["tempo"].get("bpm"))
        return "published"
    except Exception as exc:
        message = str(exc)
        if "BPM" in message or "te onzeker" in message:
            status = "held_no_reliable_bpm"
        else:
            status = "retryable_error"
        record_event(state,entry,status,error=message[:450])
        return status


def published_receipt_for_slug(entry):
    receipt = bridge.RESULTS / f'{entry["slug"]}_publish_receipt.json'
    return receipt.is_file() and receipt.stat().st_size > 10


def run_cycle(args):
    state = read_state()
    records = bridge.load_recs()
    if getattr(args,"id",None): records = [bridge.rec(args.id)]
    statuses = {}
    for entry in records:
        status = run_one(entry,state,authorized_download=args.authorized_download,
                         publish=args.publish,max_results=args.number)
        statuses[status] = statuses.get(status,0)+1
    report = {"at":bridge.now(),"statuses":statuses,"total":len(records),
              "note":"metadata-based selection, no verified digital-master fingerprints"}
    out = bridge.RESULTS/"autopilot_report.json"
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("AUTOPILOT SUMMARY:",json.dumps(report,ensure_ascii=False))
    return report


def loop(args):
    if args.publish and not args.authorized_download:
        raise RuntimeError("Autopilot publiceren uit YouTube vereist ook expliciete --authorized-download")
    bridge.RESULTS.mkdir(parents=True, exist_ok=True)
    # launchd and the CLI must not compete for the same local files.
    with (bridge.RESULTS / "autopilot.lock").open("a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("An autopilot cycle is already active; exiting without duplicate processing.")
            return
        count = 0
        while True:
            count += 1
            try:
                run_cycle(args)
            except Exception as exc:
                print("Auto-run failed; next cycle will retry:",str(exc)[:300],flush=True)
            if not args.loop: return
            if args.max_cycles and count>=args.max_cycles: return
            time.sleep(max(3600,args.interval_minutes*60))  # no faster than hourly
