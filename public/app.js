const DEFAULT_RTMP = {
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  twitch: 'rtmp://live.twitch.tv/app',
  facebook: 'rtmps://live-api-s.facebook.com:443/rtmp',
  tiktok: '',
  custom: '',
};

const state = {
  destinations: [],
  source: 'camera',       // 'camera' | 'screen'
  micOn: true,
  videoTrackStream: null, // raw camera/screen stream feeding sourceVideo
  micStream: null,        // separate mic-only stream, if micOn
  logo: {
    image: null,
    corner: 'top-right',
    sizePct: 14,
    opacityPct: 100,
  },
  drawing: false,
  outputStream: null,     // canvas + audio, what actually gets recorded
  recorder: null,
  ws: null,
  live: false,
};

const els = {
  sourceVideo: document.getElementById('sourceVideo'),
  canvas: document.getElementById('outputCanvas'),
  sourceCamBtn: document.getElementById('sourceCamBtn'),
  sourceScreenBtn: document.getElementById('sourceScreenBtn'),
  micBtn: document.getElementById('micBtn'),
  console: document.getElementById('console'),
  goLiveBtn: document.getElementById('goLiveBtn'),
  masterDot: document.getElementById('masterDot'),
  masterLabel: document.getElementById('masterLabel'),
  channelList: document.getElementById('channelList'),
  channelCount: document.getElementById('channelCount'),
  addChannelForm: document.getElementById('addChannelForm'),
  platformSelect: document.getElementById('platformSelect'),
  rtmpUrlInput: document.getElementById('rtmpUrlInput'),
  streamKeyInput: document.getElementById('streamKeyInput'),
  toggleKeyVisibility: document.getElementById('toggleKeyVisibility'),
  logoInput: document.getElementById('logoInput'),
  logoFileLabel: document.getElementById('logoFileLabel'),
  logoClearBtn: document.getElementById('logoClearBtn'),
  logoControls: document.getElementById('logoControls'),
  logoCorner: document.getElementById('logoCorner'),
  logoSize: document.getElementById('logoSize'),
  logoOpacity: document.getElementById('logoOpacity'),
};

const ctx = els.canvas.getContext('2d');

function log(line, cls) {
  const div = document.createElement('div');
  if (cls) div.className = `console__line--${cls}`;
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${line}`;
  els.console.appendChild(div);
  els.console.scrollTop = els.console.scrollHeight;
}

// ---------- Video source (camera / screen) ----------

async function setSource(source) {
  state.source = source;
  els.sourceCamBtn.dataset.active = String(source === 'camera');
  els.sourceScreenBtn.dataset.active = String(source === 'screen');

  if (state.videoTrackStream) {
    state.videoTrackStream.getTracks().forEach((t) => t.stop());
    state.videoTrackStream = null;
  }

  try {
    if (source === 'camera') {
      state.videoTrackStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } else {
      state.videoTrackStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      state.videoTrackStream.getVideoTracks()[0].addEventListener('ended', () => setSource('camera'));
      log('Streaming screen content.');
    }
    els.sourceVideo.srcObject = state.videoTrackStream;
    await els.sourceVideo.play().catch(() => {});
    sizeCanvasToSource();
    startDrawLoop();
  } catch (err) {
    log(`Could not start ${source} source: ${err.message}`, 'error');
  }
}

function sizeCanvasToSource() {
  const track = state.videoTrackStream?.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  els.canvas.width = settings.width || 1280;
  els.canvas.height = settings.height || 720;
}

async function setMic(on) {
  state.micOn = on;
  els.micBtn.dataset.active = String(on);

  if (state.micStream) {
    state.micStream.getTracks().forEach((t) => t.stop());
    state.micStream = null;
  }
  if (on) {
    try {
      state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      log(`Could not access mic: ${err.message}`, 'error');
      state.micOn = false;
      els.micBtn.dataset.active = 'false';
    }
  }
  syncOutputAudioTrack();
}

function syncOutputAudioTrack() {
  if (!state.outputStream) return;
  state.outputStream.getAudioTracks().forEach((t) => state.outputStream.removeTrack(t));
  const micTrack = state.micStream?.getAudioTracks()[0];
  if (micTrack) state.outputStream.addTrack(micTrack);
}

els.sourceCamBtn.addEventListener('click', () => setSource('camera'));
els.sourceScreenBtn.addEventListener('click', () => setSource('screen'));
els.micBtn.addEventListener('click', () => setMic(!state.micOn));

// ---------- Logo overlay ----------

els.logoInput.addEventListener('change', () => {
  const file = els.logoInput.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    state.logo.image = img;
    els.logoFileLabel.textContent = file.name;
    els.logoClearBtn.hidden = false;
    els.logoControls.hidden = false;
  };
  img.src = URL.createObjectURL(file);
});

els.logoClearBtn.addEventListener('click', () => {
  state.logo.image = null;
  els.logoInput.value = '';
  els.logoFileLabel.textContent = 'Add channel logo';
  els.logoClearBtn.hidden = true;
  els.logoControls.hidden = true;
});

els.logoCorner.addEventListener('change', () => { state.logo.corner = els.logoCorner.value; });
els.logoSize.addEventListener('input', () => { state.logo.sizePct = Number(els.logoSize.value); });
els.logoOpacity.addEventListener('input', () => { state.logo.opacityPct = Number(els.logoOpacity.value); });

function drawLogo() {
  const { image, corner, sizePct, opacityPct } = state.logo;
  if (!image) return;

  const margin = els.canvas.width * 0.02;
  const logoW = els.canvas.width * (sizePct / 100);
  const logoH = logoW * (image.height / image.width);

  let x, y;
  if (corner.includes('left')) x = margin; else x = els.canvas.width - logoW - margin;
  if (corner.includes('top')) y = margin; else y = els.canvas.height - logoH - margin;

  ctx.save();
  ctx.globalAlpha = opacityPct / 100;
  ctx.drawImage(image, x, y, logoW, logoH);
  ctx.restore();
}

// ---------- Compositing loop ----------

function startDrawLoop() {
  if (state.drawing) return;
  state.drawing = true;

  const frame = () => {
    if (!state.drawing) return;
    if (els.sourceVideo.readyState >= 2) {
      ctx.drawImage(els.sourceVideo, 0, 0, els.canvas.width, els.canvas.height);
      drawLogo();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (!state.outputStream) {
    state.outputStream = els.canvas.captureStream(30);
    syncOutputAudioTrack();
  }
}

// ---------- Destination management ----------

els.platformSelect.addEventListener('change', () => {
  els.rtmpUrlInput.value = DEFAULT_RTMP[els.platformSelect.value] || '';
});
els.rtmpUrlInput.value = DEFAULT_RTMP[els.platformSelect.value];

els.toggleKeyVisibility.addEventListener('click', () => {
  const isPassword = els.streamKeyInput.type === 'password';
  els.streamKeyInput.type = isPassword ? 'text' : 'password';
  els.toggleKeyVisibility.textContent = isPassword ? 'Hide' : 'Show';
});

els.addChannelForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const platform = els.platformSelect.value;
  const rtmpUrl = els.rtmpUrlInput.value.trim();
  const streamKey = els.streamKeyInput.value.trim();
  if (!rtmpUrl || !streamKey) return;

  state.destinations.push({ id: crypto.randomUUID(), platform, rtmpUrl, streamKey });
  els.streamKeyInput.value = '';
  renderChannels();
});

function renderChannels() {
  els.channelList.innerHTML = '';
  state.destinations.forEach((d) => {
    const li = document.createElement('li');
    li.className = 'channel';
    li.dataset.live = String(state.live);
    li.dataset.id = d.id;

    const status = document.createElement('span');
    status.className = 'channel__status';

    const info = document.createElement('div');
    info.className = 'channel__info';
    const name = document.createElement('div');
    name.className = 'channel__platform';
    name.textContent = platformLabel(d.platform);
    const url = document.createElement('div');
    url.className = 'channel__url';
    url.textContent = `${d.rtmpUrl}/••••••••`;
    info.append(name, url);

    const remove = document.createElement('button');
    remove.className = 'channel__remove';
    remove.textContent = '×';
    remove.title = 'Remove destination';
    remove.addEventListener('click', () => {
      state.destinations = state.destinations.filter((x) => x.id !== d.id);
      renderChannels();
    });

    li.append(status, info, remove);
    els.channelList.appendChild(li);
  });

  els.channelCount.textContent = `${state.destinations.length} configured`;
  els.goLiveBtn.disabled = state.destinations.length === 0;
}

function platformLabel(p) {
  return { youtube: 'YouTube', twitch: 'Twitch', facebook: 'Facebook', tiktok: 'TikTok', custom: 'Custom RTMP' }[p] || p;
}

// ---------- Go live ----------

els.goLiveBtn.addEventListener('click', () => {
  if (state.live) stopStream();
  else startStream();
});

function setLiveUI(isLive) {
  state.live = isLive;
  els.masterDot.dataset.live = String(isLive);
  els.masterLabel.textContent = isLive ? 'Live' : 'Off air';
  els.goLiveBtn.textContent = isLive ? 'Stop' : 'Go live';
  els.goLiveBtn.dataset.live = String(isLive);
  renderChannels();
}

async function startStream() {
  if (state.destinations.length === 0) {
    log('Add at least one destination first.', 'error');
    return;
  }
  if (!state.outputStream) {
    log('No video source is active.', 'error');
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);
  state.ws.binaryType = 'arraybuffer';

  state.ws.addEventListener('open', () => {
    state.ws.send(JSON.stringify({
      type: 'start',
      destinations: state.destinations.map(({ rtmpUrl, streamKey }) => ({ rtmpUrl, streamKey })),
    }));
  });

  state.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'status') {
      if (msg.status === 'live') {
        setLiveUI(true);
        log(`Live to ${state.destinations.length} destination(s).`, 'live');
        startRecording();
      } else if (msg.status === 'error') {
        log(`Server error: ${msg.message}`, 'error');
        setLiveUI(false);
      } else if (msg.status === 'stopped') {
        setLiveUI(false);
      }
    } else if (msg.type === 'log') {
      log(msg.line);
    }
  });

  state.ws.addEventListener('close', () => setLiveUI(false));
  state.ws.addEventListener('error', () => log('WebSocket connection error.', 'error'));
}

function startRecording() {
  const mimeType = 'video/webm;codecs=vp8,opus';
  state.recorder = new MediaRecorder(state.outputStream, { mimeType, videoBitsPerSecond: 3_000_000 });

  state.recorder.ondataavailable = async (e) => {
    if (e.data.size > 0 && state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(await e.data.arrayBuffer());
    }
  };

  state.recorder.start(500);
}

function stopStream() {
  if (state.recorder && state.recorder.state !== 'inactive') {
    state.recorder.stop();
  }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'stop' }));
    state.ws.close();
  }
  setLiveUI(false);
}

// ---------- Init ----------

renderChannels();
setSource('camera');
setMic(true);
log('Ready. Add your destinations, optionally drop in a logo, and hit Go live.');
