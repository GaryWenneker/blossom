export function formatClock(ms) {
  const value = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(value / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

export function safeArt(value) {
  if (typeof value !== "string" || value.includes("..")) return "";
  if (/^\/api\/albums\/[0-9a-f-]{36}\/cover$/i.test(value)) return value;
  return /^https:\/\/(?:i\.scdn\.co|mosaic\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com)\//.test(value)
    ? value : "";
}

export function playbackState(state) {
  if (!state) return { empty: true, paused: true, position: 0, duration: 0, title: "", artist: "", imageUrl: "", shuffle: false, repeat: "off" };
  const track = state.track_window?.current_track;
  const repeat = state.repeat_mode === 2 ? "track" : state.repeat_mode === 1 ? "context" : "off";
  return {
    empty: false,
    paused: !!state.paused,
    position: state.position || 0,
    duration: state.duration || track?.duration_ms || 0,
    title: track?.name || "",
    artist: track?.artists?.[0]?.name || "",
    imageUrl: safeArt(track?.album?.images?.[0]?.url || ""),
    shuffle: !!state.shuffle,
    repeat
  };
}

export function loadSpotifySdk(doc = document) {
  const win = doc.defaultView;
  if (win.Spotify) return Promise.resolve(win.Spotify);
  return new Promise((resolve, reject) => {
    win.onSpotifyWebPlaybackSDKReady = () => resolve(win.Spotify);
    const script = doc.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(Error("Spotify playback could not start in this browser."));
    doc.head.appendChild(script);
  });
}

export function createPlayback({ Spotify, getToken, onState, onNotice }) {
  let deviceId = "";
  const player = new Spotify.Player({
    name: "Blossom Player",
    volume: 0.8,
    getOAuthToken: async callback => {
      try { callback(await getToken()); }
      catch (error) { onNotice(error.message || "Reconnect Spotify in Connections."); }
    }
  });
  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id || "";
    onState({ deviceId });
  });
  player.addListener("not_ready", () => { deviceId = ""; });
  player.addListener("player_state_changed", state => onState(playbackState(state)));
  player.addListener("account_error", () => onNotice("Spotify Premium is required to play. You can still browse your library."));
  player.addListener("authentication_error", () => onNotice("Spotify playback needs a fresh connection. Reconnect Spotify in Connections."));
  player.addListener("initialization_error", () => onNotice("Spotify playback could not start in this browser."));
  player.connect();
  return {
    deviceId: () => deviceId,
    toggle: () => player.togglePlay(),
    next: () => player.nextTrack(),
    previous: () => player.previousTrack(),
    seek: ms => player.seek(ms),
    volume: level => player.setVolume(level),
    disconnect: () => player.disconnect()
  };
}
