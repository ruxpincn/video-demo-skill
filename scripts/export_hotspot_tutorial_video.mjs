#!/usr/bin/env node
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 20;
const DEFAULT_CRF = 20;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function unlinkQuiet(file) {
  try {
    await fsp.unlink(file);
  } catch {}
}

function absoluteMaybe(value, cwd = process.cwd()) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome not found. Pass --chrome or set CHROME_PATH.');
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

async function startStaticServer(root, preferredPort) {
  const server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(parsed.pathname);
      if (pathname === '/') pathname = '/index.html';
      const filePath = path.resolve(root, `.${pathname}`);
      if (!filePath.startsWith(root + path.sep) && filePath !== root) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Content-Length': stat.size
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset;
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      return {
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((resolve) => server.close(resolve))
      };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`No available static-server port starting at ${preferredPort}`);
}

async function waitForFetchJson(url, timeoutMs = 12000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw lastError || new Error(`Timed out fetching ${url}`);
}

async function ensureUrlOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tutorial URL returned ${res.status}: ${url}`);
}

function createCdpClient(wsUrl) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('This script needs a Node.js runtime with global WebSocket support. Use Node 22+.');
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome CDP')), 10000);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej, method });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try {
            ws.close();
          } catch {}
        }
      });
    });

    ws.addEventListener('message', (event) => {
      const text = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      const message = JSON.parse(text);
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        item.rej(new Error(`${item.method}: ${message.error.message}`));
      } else {
        item.res(message.result || {});
      }
    });

    ws.addEventListener('error', reject);
  });
}

function unwrapRemote(result) {
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime exception');
  }
  return result.result?.value;
}

function writeSfxWav(file, duration, events) {
  const sampleRate = 48000;
  const channels = 2;
  const samples = Math.ceil(duration * sampleRate);
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);

  function addTone(startSec, toneDuration, freqStart, freqEnd, gain, pan = 0) {
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const count = Math.max(1, Math.floor(toneDuration * sampleRate));
    let phase = 0;
    for (let i = 0; i < count && start + i < samples; i += 1) {
      const t = i / count;
      const freq = freqStart + (freqEnd - freqStart) * t;
      phase += (2 * Math.PI * freq) / sampleRate;
      const env = Math.sin(Math.PI * t) ** 0.7;
      const value = Math.sin(phase) * gain * env;
      left[start + i] += value * (pan <= 0 ? 1 : 1 - pan * 0.35);
      right[start + i] += value * (pan >= 0 ? 1 : 1 + pan * 0.35);
    }
  }

  for (const event of events) {
    const t = Math.max(0, event.videoTime || 0);
    if (event.type === 'click') {
      addTone(t, 0.055, 1150, 760, 0.23, -0.05);
      addTone(t + 0.032, 0.05, 620, 420, 0.14, 0.05);
    } else if (event.type === 'zoomTransition') {
      addTone(t, 0.34, 260, 760, 0.10, 0);
      addTone(t + 0.08, 0.22, 620, 980, 0.06, 0.08);
    } else if (event.type === 'scrollTransition') {
      const down = event.direction !== 'up';
      addTone(t, 0.28, down ? 300 : 680, down ? 680 : 300, 0.11, down ? 0.08 : -0.08);
    }
  }

  const dataBytes = samples * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buffer.writeInt16LE(Math.round(l * 32767), offset);
    offset += 2;
    buffer.writeInt16LE(Math.round(r * 32767), offset);
    offset += 2;
  }
  fs.writeFileSync(file, buffer);
}

async function runMux(silentPath, wavPath, finalPath) {
  await new Promise((resolve, reject) => {
    const mux = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-i', silentPath,
      '-i', wavPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      '-movflags', '+faststart',
      finalPath
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    mux.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    mux.on('error', reject);
    mux.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg mux failed ${code}\n${stderr}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = absoluteMaybe(args.root || process.cwd());
  const width = Number(args.width || DEFAULT_WIDTH);
  const height = Number(args.height || DEFAULT_HEIGHT);
  const fps = Number(args.fps || DEFAULT_FPS);
  const crf = String(args.crf || DEFAULT_CRF);
  const cdpPort = Number(args.port || 9347);
  const servePort = Number(args['serve-port'] || 8073);
  const chromePath = absoluteMaybe(args.chrome) || findChrome();
  const finalPath = absoluteMaybe(args.out || path.join(root, 'exports', 'hotspot-tutorial-1080p-with-sfx.mp4'));
  const outDir = path.dirname(finalPath);
  const base = path.basename(finalPath, path.extname(finalPath));
  const silentPath = path.join(outDir, `${base}.silent.tmp.mp4`);
  const wavPath = path.join(outDir, `${base}.sfx.tmp.wav`);
  const eventsPath = absoluteMaybe(args.events || path.join(outDir, `${base}.events.json`));

  await fsp.mkdir(outDir, { recursive: true });
  await Promise.all([finalPath, silentPath, wavPath].map(unlinkQuiet));

  let server = null;
  const url = args.url || (await (async () => {
    server = await startStaticServer(root, servePort);
    return server.url;
  })());

  await ensureUrlOk(url);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotspot-cdp-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--disable-gpu',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  let frameCount = 0;
  let lastFrameBuffer = null;

  try {
    await waitForFetchJson(`http://127.0.0.1:${cdpPort}/json/version`, 12000);
    const targets = await waitForFetchJson(`http://127.0.0.1:${cdpPort}/json/list`, 12000);
    const target = targets.find((item) => item.type === 'page') || targets[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target found');

    cdp = await createCdpClient(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__HOTSPOT_RECORDING_MODE = true;
        window.__videoEventLog = [];
        window.__videoStart = performance.now();
        window.__recordTutorialEvent = function(event) {
          window.__videoEventLog.push({ pageTime: (performance.now() - window.__videoStart) / 1000, ...event });
        };
      `
    });
    await cdp.send('Page.navigate', { url });
    await cdp.send('Runtime.evaluate', {
      expression: `
        (async () => {
          while (document.readyState !== 'complete') await new Promise(r => setTimeout(r, 50));
          await Promise.all(Array.from(document.images).map(img => img.complete ? true : new Promise(resolve => { img.onload = img.onerror = resolve; })));
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          if (!window.__hotspotTutorial || typeof window.__hotspotTutorial.playStep !== 'function') {
            throw new Error('Page must expose window.__hotspotTutorial.playStep(index)');
          }
          document.body.classList.add('recording-export');
          window.__videoEventLog = [];
          window.__videoStart = performance.now();
          window.__recordTutorialEvent = function(event) {
            window.__videoEventLog.push({ pageTime: (performance.now() - window.__videoStart) / 1000, ...event });
          };
          return true;
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    const styleInfo = unwrapRemote(await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const guide = document.querySelector('.guide');
        const screen = document.querySelector('.screen');
        const label = document.querySelector('.focus-label');
        const guideDisplay = guide ? getComputedStyle(guide).display : 'missing';
        const screenRect = screen ? screen.getBoundingClientRect() : null;
        const labelStyle = label ? getComputedStyle(label) : null;
        return {
          guideDisplay,
          screen: screenRect && { x: screenRect.x, y: screenRect.y, width: screenRect.width, height: screenRect.height },
          labelMaxWidth: labelStyle && labelStyle.maxWidth
        };
      })()`,
      returnByValue: true
    }));
    console.log(`STYLE ${JSON.stringify(styleInfo)}`);

    const encoder = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', String(fps),
      '-i', 'pipe:0',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', crf,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      silentPath
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encodeErr = '';
    encoder.stderr.on('data', (chunk) => {
      encodeErr += chunk.toString();
    });

    async function evalValue(expression) {
      return unwrapRemote(await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      }));
    }

    async function writeFrameBuffer(buf) {
      if (!encoder.stdin.write(buf)) await once(encoder.stdin, 'drain');
      frameCount += 1;
    }

    async function duplicateToPageTime() {
      if (!lastFrameBuffer) return;
      const pageElapsed = await evalValue('(performance.now() - window.__videoStart) / 1000');
      const targetFrames = Math.max(frameCount, Math.ceil(pageElapsed * fps));
      while (frameCount < targetFrames) {
        await writeFrameBuffer(lastFrameBuffer);
      }
    }

    async function captureFrame() {
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 93,
        fromSurface: true
      });
      const buf = Buffer.from(shot.data, 'base64');
      lastFrameBuffer = buf;
      await writeFrameBuffer(buf);
    }

    async function recordStep(index) {
      await cdp.send('Runtime.evaluate', {
        expression: `
          window.__recordingStepDone = false;
          Promise.resolve(window.__hotspotTutorial.playStep(${index})).then(() => {
            window.__recordingStepDone = true;
          });
        `,
        awaitPromise: false
      });
      const started = Date.now();
      while (true) {
        const frameStarted = Date.now();
        await captureFrame();
        await duplicateToPageTime();
        const done = await evalValue('Boolean(window.__recordingStepDone)');
        if (done) break;
        const remaining = Math.max(0, 1000 / fps - (Date.now() - frameStarted));
        if (remaining > 0) await sleep(remaining);
        if (Date.now() - started > 25000) {
          throw new Error(`Step ${index + 1} timed out`);
        }
      }
      console.log(`STEP ${index + 1} frames=${frameCount}`);
    }

    const totalSteps = await evalValue('window.__hotspotTutorial.steps.length');
    await cdp.send('Runtime.evaluate', {
      expression: `
        window.__videoEventLog = [];
        window.__videoStart = performance.now();
        window.__recordTutorialEvent = function(event) {
          window.__videoEventLog.push({ pageTime: (performance.now() - window.__videoStart) / 1000, ...event });
        };
      `,
      awaitPromise: true,
      returnByValue: true
    });
    for (let i = 0; i < totalSteps; i += 1) {
      await recordStep(i);
    }

    const pageElapsed = await evalValue('(performance.now() - window.__videoStart) / 1000');
    const pageEvents = await evalValue('window.__videoEventLog');
    await duplicateToPageTime();

    encoder.stdin.end();
    const encodeCode = await new Promise((resolve) => encoder.on('close', resolve));
    if (encodeCode !== 0) throw new Error(`ffmpeg encode failed ${encodeCode}\n${encodeErr}`);

    const videoDuration = frameCount / fps;
    const scale = pageElapsed > 0 ? videoDuration / pageElapsed : 1;
    const events = pageEvents.map((event) => ({
      ...event,
      videoTime: Math.max(0, event.pageTime * scale)
    }));

    await fsp.writeFile(eventsPath, JSON.stringify({
      url,
      width,
      height,
      fps,
      frameCount,
      videoDuration,
      pageElapsed,
      scale,
      events
    }, null, 2));

    writeSfxWav(
      wavPath,
      videoDuration,
      events.filter((event) => ['click', 'zoomTransition', 'scrollTransition'].includes(event.type))
    );
    await runMux(silentPath, wavPath, finalPath);
    await Promise.all([silentPath, wavPath].map(unlinkQuiet));

    const stat = await fsp.stat(finalPath);
    console.log(JSON.stringify({
      finalPath,
      eventsPath,
      width,
      height,
      fps,
      frameCount,
      videoDuration,
      sizeMB: +(stat.size / 1048576).toFixed(2)
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    try {
      chrome.kill('SIGTERM');
    } catch {}
    setTimeout(() => {
      try {
        chrome.kill('SIGKILL');
      } catch {}
    }, 1000).unref();
    try {
      await fsp.rm(userDataDir, { recursive: true, force: true });
    } catch {}
    if (server) await server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
