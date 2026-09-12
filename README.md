# Multicast — go live on multiple platforms at once

A browser control panel (HTML/CSS/JS) + a small Node server. The browser captures your
camera/mic or screen, streams it to your own local server, and the server uses ffmpeg
to fan that single feed out to every RTMP destination you've configured — YouTube,
Twitch, Facebook, TikTok, or any custom RTMP endpoint — simultaneously.

## Why there's a server at all

Browsers can't speak RTMP directly — no browser API sends RTMP. So the actual
multi-platform relay can't happen in pure client-side JS. The architecture here is the
same one real multistreaming services use under the hood:

1. **Browser** captures video/audio and streams encoded chunks over a WebSocket.
2. **Server** (`server.js`) pipes those chunks into one `ffmpeg` process using its
   `tee` muxer, which republishes to every destination at once from a single encode.

This runs on your own machine — your stream keys never leave your browser and your
local server.

## Setup

Requires **Node.js 18+** and **ffmpeg** installed and on your PATH.

```bash
cd multistream-app
npm install
npm start
```

Open `http://localhost:3000`.

## Using it

1. Pick your video source: **Camera** or **Screen** (screen capture asks the browser's
   native "choose a window/tab/screen" picker). Toggle **Mic** on/off independently.
2. Optional: click **Add channel logo**, upload an image, then set its corner,
   size, and opacity. The logo is composited onto every frame in the browser via
   canvas — it's baked into the video before it ever reaches the server, so it shows
   up on every destination automatically.
3. For each platform: pick it from the dropdown (fills in the standard RTMP URL),
   paste the stream key from that platform's "Go Live" / streaming settings page,
   click **Add destination**.
4. Click **Go live**. All configured destinations receive the same composited feed
   at once.
5. Click **Stop** to end the broadcast everywhere.

The on-screen preview is the canvas itself, so what you see (screen or camera, plus
logo placement) is exactly what goes out to every platform.

## Known limitations, honestly

- **Logo compositing runs on the browser's main thread** via `requestAnimationFrame` +
  canvas — fine for casual streaming, but a slower machine may drop frames faster than
  it would streaming raw camera/screen video without an overlay.
- Screen capture on Android and iOS browsers is inconsistent/unsupported in several
  cases — this feature is most reliable on desktop Chrome/Edge/Firefox.

- **Chunked-WebM relay is a pragmatic hack, not broadcast-grade.** `MediaRecorder`
  produces fragmented WebM, and ffmpeg reads it as a live pipe — this works for
  casual streaming but is more fragile than a proper RTMP/WHIP encoder (occasional
  keyframe hiccups, no automatic reconnect on a dropped destination). For serious use,
  swap the browser encoder for OBS pointed at the same tee-ffmpeg approach, or
  render this UI purely as a destination-key manager and let OBS do the encoding.
- **One destination failing doesn't stop the others** in ffmpeg's tee muxer, but
  there's no per-destination retry logic here — add it in `server.js` if you need it.
- **Platform policies**: YouTube, Twitch, Facebook, and TikTok each have their own
  rules on simultaneous/simulcast streaming (some restrict it below certain account
  tiers or require using their own official multistream tool). Check each platform's
  current terms before relying on this for anything that matters.
- Get each stream key from the platform's own live-streaming dashboard — this app
  doesn't create accounts or streams for you, only relays to keys you provide.
