#!/usr/bin/env python3
"""Search YouTube, measure authorized audio locally, and publish via Blossom MCP.

Explicit approval is needed before any YouTube download, and confirmation of the
exact edition is required before database writes. No copyrighted sample reuse.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from urllib.parse import urlparse
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
import stat
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "recordings.json"
RESULTS = ROOT / "results"
AUDIO = ROOT / "audio"
DOWNLOADS = ROOT / "downloads"
DEFAULT_LOCAL_MCP = "http://127.0.0.1:8787/mcp"


def now():
    return datetime.now(timezone.utc).isoformat()


def load_recs():
    return json.loads(CATALOG.read_text(encoding="utf-8"))["recordings"]


def rec(ref):
    for entry in load_recs():
        if ref in (entry["blossom_id"], entry["slug"], entry["title"]):
            return entry
    raise SystemExit("Onbekende opname. Gebruik `list` voor alle ID's.")


def run(args, *, timeout=600):
    try:
        return subprocess.run(args, capture_output=True, text=True, check=True, timeout=timeout)
    except FileNotFoundError as e:
        raise RuntimeError(f"Ontbrekend programma: {args[0]} (installeer via install.command)") from e
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Commandofout ({args[0]}): {e.stderr[-1600:]}") from e


def search(entry, n=5):
    """Metadata-only YouTube search. Never assumes top-ranked result is right."""
    query = f'{entry["artist"]} {entry["title"]} {entry["edition_to_verify"]}'
    cmd = ["yt-dlp", "--ignore-config", "--no-warnings", "--flat-playlist", "--skip-download",
           "--dump-single-json", f"ytsearch{n}:{query}"]
    data = json.loads(run(cmd, timeout=90).stdout)
    rows = []
    for v in data.get("entries", []):
        if not v or not v.get("id"):
            continue
        video_id = str(v["id"])
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            continue
        rows.append({
            "url": "https://www.youtube.com/watch?v=" + video_id,
            "video_id": video_id,
            "title": v.get("title", ""),
            "channel": v.get("uploader") or v.get("channel") or "(unknown)",
            "duration_seconds": v.get("duration"),
            "note": "Search suggestion, NOT validated as the specified audio master",
        })
    return {"blossom_id": entry["blossom_id"], "artist": entry["artist"],
            "title": entry["title"], "edition_to_verify": entry["edition_to_verify"],
            "query": query, "candidates": rows, "searched_at": now()}


def do_search(entry, n):
    data = search(entry, n)
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f'{entry["slug"]}_candidates.json'
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f'\n{entry["artist"]} - {entry["title"]}')
    print(f'EXACTE VERSIE: {entry["edition_to_verify"]}')
    for i, item in enumerate(data["candidates"], 1):
        secs = item.get("duration_seconds")
        dur = f'{int(secs)//60}:{int(secs)%60:02d}' if secs else "?"
        print(f' {i}. {item["title"][:70]} [{dur}] / {item["channel"]}')
        print(f'    {item["url"]}')
    print(f'Gevonden gegevens: {path}')
    return data


def validate_video_url(url):
    """Only single YouTube video URLs, no arbitrary domains or playlists."""
    from urllib.parse import urlparse, parse_qs
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in {"youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"}:
        raise ValueError("Alleen HTTPS YouTube-video-URL's worden geaccepteerd.")
    video = parse_qs(u.query).get("v", [None])[0] if u.hostname != "youtu.be" else u.path.strip("/")
    if not video or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video):
        raise ValueError("Een YouTube-video-ID is vereist; playlists worden geweigerd.")
    return "https://www.youtube.com/watch?v=" + video


def download_authorized(entry, url, permitted=False):
    if not permitted:
        raise RuntimeError("Download geblokkeerd: vereist --authorized-download (en relevante gebruiksrechten).")
    url = validate_video_url(url)
    dest = DOWNLOADS / entry["slug"]
    dest.mkdir(parents=True, exist_ok=True)
    cmd = ["yt-dlp", "--ignore-config", "--no-playlist", "--no-warnings",
           "--restrict-filenames", "-f", "bestaudio/best", "--no-part",
           "-o", str(dest / "%(id)s.%(ext)s"),
           "--print", "after_move:filepath", url]
    cp = run(cmd, timeout=1200)
    paths = [Path(s.strip()) for s in cp.stdout.splitlines() if s.strip()]
    path = next((p for p in reversed(paths) if p.is_file()), None)
    if path is None:
        raise RuntimeError("De downloader meldde geen geldig audiobestand. Controleer de foutmeldingen.")
    # ffmpeg provides deterministic PCM input for librosa/soundfile including WEBM/OPUS.
    AUDIO.mkdir(exist_ok=True)
    wav = AUDIO / entry["filename"]
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
         "-vn", "-ac", "2", "-ar", "22050", "-c:a", "pcm_s16le", str(wav)], timeout=1200)
    record = {"url": url, "downloaded_from": str(path), "normalized_pcm": str(wav),
              "rights_assertion": "User explicitly confirmed authorization for this download",
              "identity_check": "NOT VERIFIED until --confirmed-edition", "timestamp_utc": now(),
              "note": "Source may be a lossy YouTube transcode; do not label it studio master."}
    (dest / "provenance.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print("Audio ontvangen en naar WAV gedecodeerd:", wav)
    print("LET OP: dit bewijst niet welke originele mix/master is gebruikt.")
    return wav


def metrics_path(entry):
    RESULTS.mkdir(exist_ok=True)
    return RESULTS / f'{entry["slug"]}_measurements.json'


def measure(entry, file_path=None):
    from audio_metrics import analyze_track
    path = Path(file_path).expanduser().resolve() if file_path else AUDIO / entry["filename"]
    if not path.is_file():
        raise FileNotFoundError(f"Audiobestand ontbreekt: {path}")
    print("Audio meten (kan enkele minuten duren):", path)
    result = analyze_track(path, entry)
    source_doc = DOWNLOADS / entry["slug"] / "provenance.json"
    if source_doc.exists():
        result["video_source"] = json.loads(source_doc.read_text(encoding="utf-8"))
    result["measurement_warning"] = "Measured waveform only, NOT verified mix; no AI claims of auditory listening."
    target = metrics_path(entry)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    t = result["audio_measurements"]["tempo"]
    k = result["audio_measurements"]["tonality"]
    print("BPM:", t.get("bpm"), "| confidence:", t.get("confidence"))
    print("Key:", k.get("key"), "| tentative:", k.get("tentative_key"))
    print("Measurements:", target)
    return result


def _mcp_auth(url: str) -> str:
    """Use an explicit token, or the local *owner-only* Blossom .env file.

    A local server credential MUST NOT be forwarded to a remote URL merely
    because BLOSSOM_MCP_URL has been configured differently.
    """
    explicit = os.environ.get("BLOSSOM_MCP_TOKEN", "").strip()
    if explicit:
        return explicit
    host = urlparse(url).hostname
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError(
            "Externe MCP vereist een expliciet BLOSSOM_MCP_TOKEN (OAuth access token). "
            "De lokale Blossom .env wordt nooit automatisch naar externe servers verstuurd."
        )
    token = os.environ.get("BLOSSOM_MCP_WRITE_TOKEN", "").strip()
    if token:
        return token
    envfile = ROOT.parent / ".env"  # standard install: ~/io/blossom/analyzer
    if not envfile.exists():
        raise RuntimeError(
            "Geen MCP-write-token beschikbaar. Verwacht Blossom .env in "
            f"{envfile} of zet BLOSSOM_MCP_TOKEN / BLOSSOM_MCP_WRITE_TOKEN. "
            "Voer in de Blossom root eventueel: npm run mcp:diagnose"
        )
    st = envfile.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise RuntimeError("Blossom .env moet een gewoon bestand van jezelf met rechten 0600 zijn (geen symlink).")
    import shlex
    for line in envfile.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if line.startswith("BLOSSOM_MCP_WRITE_TOKEN="):
            raw = line.split("=", 1)[1]
            try:
                parts = shlex.split(raw, comments=True)
            except ValueError:
                parts = []
            if len(parts) != 1 or len(parts[0]) < 32:
                raise RuntimeError("BLOSSOM_MCP_WRITE_TOKEN is ongeldig of te kort in .env")
            return parts[0]
    raise RuntimeError(f"BLOSSOM_MCP_WRITE_TOKEN ontbreekt in {envfile} (niet delen in chat).")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BlossomHttpRpc:
    """The real Blossom server uses stateless, authenticated JSON-RPC POST.

    It is NOT an MCP SDK Streamable HTTP server. The generic MCP v2 Client
    negotiation/discovery produces opaque ExceptionGroups against this server.
    """
    def __init__(self, url: str, token: str):
        parsed = urlparse(url)
        if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("Onbeveiligde HTTP MCP buiten loopback is niet toegestaan")
        if parsed.scheme not in {"http", "https"} or parsed.path != "/mcp":
            raise RuntimeError("Gebruik een Blossom MCP-URL die eindigt op /mcp")
        self.url = url
        self.token = token
        self.opener = build_opener(ProxyHandler({}) if parsed.hostname in {"127.0.0.1", "localhost", "::1"} else ProxyHandler(), _NoRedirect())
        self.request_id = 0

    def _post_sync(self, method: str, params: dict):
        self.request_id += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self.request_id, "method": method, "params": params}).encode("utf-8")
        request = Request(self.url, data=body, headers={
            "Content-Type": "application/json", "Accept": "application/json",
            "Authorization": "Bearer " + self.token,
            "MCP-Protocol-Version": "2025-06-18"}, method="POST")
        try:
            with self.opener.open(request, timeout=30) as r:
                raw = r.read(2_000_000)
        except HTTPError as e:
            code = e.code
            hint = {401: "Ongeldige/ontbrekende Bearer-authenticatie; controleer Blossom .env en of de server herstart is.",
                    403: "Geen schrijfrechten voor deze token (gebruik BLOSSOM_MCP_WRITE_TOKEN).",
                    404: "MCP-route niet actief; controleer serverconfiguratie/URL en npm run mcp:diagnose.",
                    405: "MCP-route accepteert geen POST; controleer de URL.",
                    502: "Gateway/proxy kan Blossom niet bereiken."}.get(code, "Bekijk serverlogboeken.")
            raise RuntimeError(f"Blossom MCP HTTP {code}: {hint}") from None
        except (URLError, TimeoutError, ConnectionError) as e:
            raise RuntimeError(f"Blossom MCP is niet bereikbaar op {self.url}. Start de lokale server en voer npm run mcp:diagnose uit.") from None
        try:
            reply = json.loads(raw)
        except ValueError:
            raise RuntimeError("MCP geeft geen JSON terug. Waarschijnlijk onjuiste route/gateway.") from None
        if "error" in reply:
            err = reply["error"]
            raise RuntimeError(f"Blossom MCP {method} fout {err.get('code')}: {str(err.get('message',''))[:240]}")
        if "result" not in reply:
            raise RuntimeError(f"Blossom MCP {method} gaf geen JSON-RPC result terug")
        return reply["result"]

    async def _post(self, method: str, params: dict | None = None):
        return await asyncio.to_thread(self._post_sync, method, params or {})

    async def initialize(self):
        result = await self._post("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                                "clientInfo": {"name": "3TWNTY-Bridge", "version": "1.1.0"}})
        if "serverInfo" not in result:
            raise RuntimeError("Blossom MCP initialize antwoordt niet als verwacht")

    async def list_tools(self):
        result = await self._post("tools/list")
        return SimpleNamespace(tools=[SimpleNamespace(**obj) for obj in result.get("tools", [])])

    async def call_tool(self, name: str, args: dict):
        result = await self._post("tools/call", {"name": name, "arguments": args})
        return SimpleNamespace(is_error=bool(result.get("isError", False)),
                               structured_content=None,
                               content=[SimpleNamespace(text=item.get("text", "")) for item in result.get("content", [])])


@asynccontextmanager
async def connection():
    url = os.environ.get("BLOSSOM_MCP_URL", DEFAULT_LOCAL_MCP)
    token = _mcp_auth(url)
    if len(token) < 32:
        raise RuntimeError("MCP-token is te kort (minimaal 32 tekens).")
    client = BlossomHttpRpc(url, token)
    await client.initialize()
    yield client


async def assert_tools(client, needed):
    tools = await client.list_tools()
    present = {x.name for x in tools.tools}
    missing = sorted(set(needed) - present)
    if missing:
        raise RuntimeError(f"Blossom MCP mist tool(s): {missing}. Gevonden: {sorted(present)}")
    return present


def tool_content(result):
    if result.is_error:
        raise RuntimeError("Blossom MCP antwoordt met fout: " + repr(result.content))
    value = getattr(result, "structured_content", None)
    if isinstance(value, dict):
        if "result" in value and isinstance(value["result"], dict):
            return value["result"]
        return value
    for c in result.content:
        s = getattr(c, "text", None)
        if isinstance(s, str):
            try:
                return json.loads(s)
            except ValueError:
                pass
    raise RuntimeError("Blossom MCP resultaat is geen bruikbaar JSON-object.")


async def check_mcp():
    async with connection() as client:
        names = await assert_tools(client, ["music_dna_get", "music_dna_save_analysis"])
        print("MCP verbonden:", os.getenv("BLOSSOM_MCP_URL", DEFAULT_LOCAL_MCP))
        print("Music DNA tools gevonden:", ", ".join(sorted(n for n in names if "music_dna" in n)))


def publish_payload(entry, result, existing, auto_verified=False):
    a = (existing.get("analysis") or {}) if isinstance(existing, dict) else {}
    metrics = result["audio_measurements"]
    bpm = metrics.get("tempo", {}).get("bpm")
    if not isinstance(bpm, (int, float)) or not (40 <= bpm <= 250):
        raise RuntimeError("Geen voldoende betrouwbare BPM. Blossom vereist BPM; overslaan, NIET gokken.")
    t = metrics.get("tempo", {})
    # Avoid promoting a questionable beat detector output to a precise BPM fact.
    confidence_label = str(t.get("confidence", "")).lower()
    if ("insufficient" in confidence_label or confidence_label.startswith("low")
            or t.get("agreement_fraction", 1) < .5):
        raise RuntimeError("BPM-meting te onzeker; er is handmatige verificatie nodig.")
    sha = result["audio_source_provenance"]["sha256"]
    youtube = (result.get("video_source") or {}).get("url", "not supplied")
    notes = (
        f"LOCAL AUDIO MEASUREMENT ({'automatically matched YouTube edition from metadata; NOT master-verified' if auto_verified else 'user-confirmed source edition'}): {entry['title']}. "
        f"Waveform SHA256 {sha}; source {youtube}; "
        f"tempo approx {bpm} BPM ({t.get('confidence')}); "
        f"possible half/double time {t.get('half_time_alternative_bpm')}/{t.get('double_time_alternative_bpm')} BPM; "
        f"integrated loudness {metrics.get('ebu_r128',{}).get('integrated_lufs')} LUFS, "
        f"LRA {metrics.get('ebu_r128',{}).get('loudness_range_lu')} LU, "
        f"sample peak {metrics.get('sample_peak_dbfs')} dBFS, "
        f"duration {metrics.get('duration_seconds')}s. "
        f"Measured audio may be a lossy YouTube re-encode, not the original studio master. "
        f"Key inference is low confidence and may be omitted. "
        f"Full evidence: {metrics_path(entry).name}. "
        f"No instrument recognition, vocal source separation or verified timestamps performed."
    )
    summary = (str(a.get("summary") or "") + "\n" + notes).strip()
    # cap stored summary for backend compatibility; old source info retained in v1 version history.
    if len(summary) > 3800:
        summary = notes + " [Prior catalogue analysis remains in previous DNA version.]"
    # Only include known accepted v1 schema fields. Embed detailed measures in summary + JSON on disk.
    return {
        "schemaVersion": 1,
        "bpm": float(bpm),
        "musicalKey": str(metrics.get("tonality", {}).get("key") or a.get("musicalKey") or "")[:32],
        "timeSignature": str(a.get("timeSignature") or ""), # not inferred from onset periodicity
        "durationMs": int(round(float(metrics["duration_seconds"]) * 1000)),
        "genres": a.get("genres") or ["Electronic"],
        "moods": a.get("moods") or [],
        "instruments": a.get("instruments") or [],
        "vocals": a.get("vocals") or {"type": "Not established", "delivery": "No auditory instrument/vocal classification was performed"},
        "production": a.get("production") or {"era": "Unknown", "texture": "See audio measurement provenance"},
        "sections": a.get("sections") or [],
        "barBlocks": a.get("barBlocks") or [],
        "summary": summary,
        "analysisMethod": "local-ffmpeg-librosa-measured+prior-catalogue-v1",
        "analyzer": "3TWNTY Blossom YouTube Bridge",
        "confidence": min(0.58 if auto_verified else 0.7, float(a.get("confidence") or 0.5)),
        "measurements": None, # entire structured record in local results; avoid unknown backend schema
    }


async def publish(entry, confirmed=False, auto_verified=False):
    if not confirmed and not auto_verified:
        raise RuntimeError("MCP-schrijven vereist --confirmed-edition of gecontroleerde autopilot-provenance.")
    path = metrics_path(entry)
    if not path.exists():
        raise RuntimeError(f"Geen metingen: {path} ; voer eerst measure uit.")
    result = json.loads(path.read_text(encoding="utf-8"))
    if result["reference"]["blossom_id"] != entry["blossom_id"]:
        raise RuntimeError("Mismatch tussen meting en Blossom recording-ID; stoppen.")
    if auto_verified:
        auto = result.get("video_source", {}).get("auto_selection", {})
        if not auto or auto.get("status") != "metadata_match_only_not_master_fingerprint" or auto.get("score", 0) < 87:
            raise RuntimeError("Autopilot heeft geen voldoende sterke audiosource-match; publicatie tegengehouden.")
        if auto.get("candidate_video_id") not in str(result.get("video_source", {}).get("url", "")):
            raise RuntimeError("YouTube bron en geautomatiseerde match komen niet overeen.")
    # Guard against reusing stale JSON when audio changed after measurement.
    from audio_metrics import sha256
    measured_path = Path(result["audio_source_provenance"]["file"])
    if not measured_path.is_file() or sha256(measured_path) != result["audio_source_provenance"]["sha256"]:
        raise RuntimeError("Audio ontbreekt of is veranderd sinds de meting; opnieuw meten.")
    async with connection() as client:
        await assert_tools(client, ["music_dna_get", "music_dna_save_analysis"])
        previous = tool_content(await client.call_tool("music_dna_get", {"id": entry["blossom_id"]}))
        if isinstance(previous, dict) and previous.get("id") not in (None, entry["blossom_id"]):
            raise RuntimeError("MCP gaf een ander recording-ID terug. Afgebroken.")
        payload = publish_payload(entry, result, previous, auto_verified=auto_verified)
        print("Opslaan in Blossom:", entry["title"])
        saved = tool_content(await client.call_tool("music_dna_save_analysis",
            {"id": entry["blossom_id"], "analysis": payload}))
        if not isinstance(saved, dict) or saved.get("id") != entry["blossom_id"]:
            raise RuntimeError("Schrijven is niet geverifieerd; inspecteer serverlogs.")
        print("Gelukt:", saved.get("title"), "DNA versie", saved.get("analysisVersion"))
        (RESULTS / f'{entry["slug"]}_publish_receipt.json').write_text(
            json.dumps({"saved_at": now(), "blossom_id": saved["id"],
                        "analysisVersion": saved.get("analysisVersion"), "sha256": result["audio_source_provenance"]["sha256"]}, indent=2),
            encoding="utf-8")


def parser():
    p = argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="Toon 13 bekende Blossom-referenties")
    s = sub.add_parser("search", help="Zoek metadata op YouTube (geen download)")
    s.add_argument("id");s.add_argument("--number", type=int, default=5)
    s = sub.add_parser("search-all", help="Zoek kandidaten voor alle 13 opnamen (metadata)")
    s.add_argument("--number", type=int, default=3)
    s = sub.add_parser("guided", help="Zoek, laat kandidaat kiezen, download toegestaan materiaal en meet")
    s.add_argument("id");s.add_argument("--authorized-download",action="store_true")
    s = sub.add_parser("download", help="Download toegestane video-audio naar WAV")
    s.add_argument("id");s.add_argument("--url",required=True)
    s.add_argument("--authorized-download",action="store_true")
    s = sub.add_parser("measure",help="Meet bestaand WAV/FLAC/MP3/M4A-bestand")
    s.add_argument("id");s.add_argument("--file",default=None)
    s = sub.add_parser("publish",help="Publiceer in Blossom na expliciete mixcontrole")
    s.add_argument("id");s.add_argument("--confirmed-edition",action="store_true")
    sub.add_parser("mcp-test",help="Controleer geautoriseerde Blossom MCP tools")
    s=sub.add_parser("autopilot",help="Zoek, selecteer, analyseer en publiceer automatisch; hervatbaar en optioneel periodiek")
    s.add_argument("id", nargs="?", default=None, help="Optioneel: één opname; anders alle 13")
    s.add_argument("--authorized-download", action="store_true",
                   help="Bevestig vooraf dat je toestemming/rechten hebt voor het downloaden en analyseren van alle geselecteerde audio")
    s.add_argument("--publish", action="store_true",help="Schrijf sterk gematchte metingen zonder handmatige tussenstappen naar Blossom")
    s.add_argument("--number",type=int,default=8,help="Aantal resultaten per zoekstrategie")
    s.add_argument("--loop",action="store_true", help="Blijf elk uur (of langzamer) opnieuw proberen")
    s.add_argument("--interval-minutes",type=int,default=60)
    s.add_argument("--max-cycles",type=int,default=0,help="0 betekent oneindig als --loop opgegeven")
    s=sub.add_parser("process",help="Automatische meting en optioneel expliciet MCP publiceren")
    s.add_argument("id");s.add_argument("--url",default=None);s.add_argument("--file",default=None)
    s.add_argument("--authorized-download",action="store_true")
    s.add_argument("--publish",action="store_true");s.add_argument("--confirmed-edition",action="store_true")
    return p


def main():
    args=parser().parse_args()
    try:
        if args.command=="list":
            for x in load_recs():
                print(x["slug"], "|", x["artist"], "-", x["title"])
        elif args.command=="search":
            do_search(rec(args.id),args.number)
        elif args.command=="search-all":
            for x in load_recs():
                try: do_search(x,args.number)
                except Exception as e: print("Search failed:",x["title"],e,file=sys.stderr)
        elif args.command=="guided":
            x=rec(args.id)
            data=do_search(x,5)
            if not data["candidates"]:raise RuntimeError("Geen kandidaten gevonden.")
            choice=input("Welke index hoort bij de JUISTE versie? [enter annuleert] ").strip()
            if not choice: return
            n=int(choice)
            if n<1 or n>len(data["candidates"]): raise RuntimeError("Ongeldige selectie.")
            path=download_authorized(x,data["candidates"][n-1]["url"],args.authorized_download)
            measure(x,path)
            print("Controleer de editie voordat je `publish --confirmed-edition` gebruikt.")
        elif args.command=="download":
            download_authorized(rec(args.id),args.url,args.authorized_download)
        elif args.command=="measure":
            measure(rec(args.id),args.file)
        elif args.command=="mcp-test":
            asyncio.run(check_mcp())
        elif args.command=="autopilot":
            from autopilot import loop
            loop(args)
        elif args.command=="publish":
            asyncio.run(publish(rec(args.id),args.confirmed_edition))
        elif args.command=="process":
            x=rec(args.id)
            if bool(args.url)==bool(args.file):
                raise RuntimeError("Geef precies één van --url of --file op.")
            path=download_authorized(x,args.url,args.authorized_download) if args.url else Path(args.file)
            measure(x,path)
            if args.publish:
                asyncio.run(publish(x,args.confirmed_edition))
            else:
                print("Geanalyseerd, niet gepubliceerd. Gebruik publish --confirmed-edition na controle.")
    except (RuntimeError,OSError,ValueError,FileNotFoundError) as ex:
        print("FOUT:", ex,file=sys.stderr)
        raise SystemExit(2)

if __name__=="__main__": main()
