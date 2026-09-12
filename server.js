const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let ffmpegProcess = null;

function buildTeeOutput(destinations) {
  // ffmpeg's tee muxer fans one input out to N outputs in a single process.
  // Each leg gets its own flv-over-rtmp target.
  return destinations
    .map((d) => {
      const base = d.rtmpUrl.replace(/\/+$/, '');
      const key = d.streamKey.replace(/\|/g, ''); // '|' is the tee separator, strip if present
      return `[f=flv]${base}/${key}`;
    })
    .join('|');
}

function startFfmpeg(destinations, onLog) {
  if (ffmpegProcess) stopFfmpeg();
  if (!destinations || destinations.length === 0) {
    throw new Error('No destinations provided');
  }

  const teeOutput = buildTeeOutput(destinations);

  const args = [
    '-loglevel', 'warning',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-b:v', '3000k',
    '-maxrate', '3500k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-keyint_min', '60',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',
    '-f', 'tee',
    teeOutput,
  ];

  ffmpegProcess = spawn('ffmpeg', args);

  ffmpegProcess.stderr.on('data', (data) => onLog?.(data.toString()));
  ffmpegProcess.on('close', (code) => {
    onLog?.(`ffmpeg exited with code ${code}`);
    ffmpegProcess = null;
  });
  ffmpegProcess.on('error', (err) => {
    onLog?.(`ffmpeg failed to start: ${err.message}. Is ffmpeg installed and on PATH?`);
    ffmpegProcess = null;
  });

  return ffmpegProcess;
}

function stopFfmpeg() {
  if (!ffmpegProcess) return;
  try {
    ffmpegProcess.stdin.end();
  } catch (_) {}
  ffmpegProcess.kill('SIGINT');
  ffmpegProcess = null;
}

wss.on('connection', (ws) => {
  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.on('message', (message, isBinary) => {
    if (!isBinary) {
      let msg;
      try {
        msg = JSON.parse(message.toString());
      } catch {
        return;
      }

      if (msg.type === 'start') {
        try {
          startFfmpeg(msg.destinations, (line) => send({ type: 'log', line }));
          send({ type: 'status', status: 'live' });
        } catch (err) {
          send({ type: 'status', status: 'error', message: err.message });
        }
      } else if (msg.type === 'stop') {
        stopFfmpeg();
        send({ type: 'status', status: 'stopped' });
      }
      return;
    }

    // Binary = a chunk of the browser's MediaRecorder output.
    if (ffmpegProcess && ffmpegProcess.stdin.writable) {
      ffmpegProcess.stdin.write(message);
    }
  });

  ws.on('close', () => stopFfmpeg());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Multistream control server on http://localhost:${PORT}`);
});
