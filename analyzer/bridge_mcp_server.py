#!/usr/bin/env python3
"""Optional local STDIO MCP interface for the Blossom YouTube Audio Bridge.

To make these tools callable by remote ChatGPT through Blossom, the authenticated
Blossom gateway must explicitly register/forward them; this file alone does not
modify the installed Blossom MCP gateway.
"""
import asyncio
from mcp.server import MCPServer
import blossom_bridge as core

server = MCPServer("3TWNTY Audio Bridge")


@server.tool()
def blossom_youtube_find_candidates(recording_id: str, limit: int = 5) -> dict:
    """Search YouTube video METADATA for a specific existing Blossom recording ID.

    Does not download or analyze any audio, and does not automatically assume
    the first search result is the original recording/mix.
    """
    return core.search(core.rec(recording_id), max(1, min(limit, 10)))


@server.tool()
def blossom_youtube_acquire_authorized(recording_id: str, video_url: str, rights_confirmed: bool = False) -> dict:
    """Download a single approved video only with user-confirmed legal rights.

    Never invoke without explicit rights approval for that particular download.
    This does not verify the historical mix/edition.
    """
    x = core.rec(recording_id)
    path = core.download_authorized(x, video_url, permitted=rights_confirmed)
    return {"recording_id": x["blossom_id"], "pcm_file": str(path),
            "status": "downloaded_unverified_audio_edition"}


@server.tool()
def blossom_audio_measure_local(recording_id: str) -> dict:
    """Analyze the locally available WAV file for this exact Blossom recording.

    Returns measured BPM estimate, key uncertainty and loudness; full evidence is
    written to disk. This does NOT automatically publish to Blossom.
    """
    x = core.rec(recording_id)
    return core.measure(x)


@server.tool()
async def blossom_audio_publish_measurement(recording_id: str, edition_confirmed: bool = False) -> dict:
    """Publish measured audio DNA via authorized Blossom MCP once edition is confirmed.

    Will refuse uncertain/absent tempo, stale audio and unconfirmed mixes.
    """
    if not edition_confirmed:
        raise ValueError("Explicit edition confirmation is required before Blossom writes.")
    x = core.rec(recording_id)
    await core.publish(x, edition_confirmed)
    return {"recording_id": x["blossom_id"], "status": "publish_confirmed_by_blossom"}


if __name__ == "__main__":
    # STDIO only: do not expose the tool server on an unauthenticated network port.
    server.run(transport="stdio")
