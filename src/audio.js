// ── Audio processing ─ extracted from App.js (strangle) ──
// Recording upload path: detect formats Whisper can't take, transcode to mp3
// via self-hosted ffmpeg.wasm, and resumable-upload to storage. Shared by the
// contact recordings section and the App-level recording uploader.
import { supabase, SUPABASE_URL } from './dataService';

export const WHISPER_OK_EXT = ['mp3', 'm4a', 'wav', 'webm', 'mp4', 'mpeg', 'mpga', 'ogg', 'oga', 'flac', 'aac'];
export function audioNeedsConversion(file) {
  const name = (file?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return !WHISPER_OK_EXT.includes(ext); // amr, 3gp, 3gpp, awb, etc.
}
let __ffmpegPromise = null;
function __loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-ff="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.setAttribute('data-ff', src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the audio converter.'));
    document.head.appendChild(s);
  });
}
async function getFfmpeg() {
  if (__ffmpegPromise) return __ffmpegPromise;
  __ffmpegPromise = (async () => {
    const origin = window.location.origin;
    // Self-hosted, same-origin assets under /ffmpeg/. Loading ffmpeg.js from our
    // own origin makes the FFmpeg class create a CLASSIC, same-origin worker
    // automatically. (Passing classWorkerURL forces a *module* worker, which
    // can't importScripts the UMD core → "failed to import ffmpeg-core.js".)
    // Same-origin also avoids the cross-origin Worker block. Verified working.
    await __loadScriptOnce(`${origin}/ffmpeg/ffmpeg.js`);
    await __loadScriptOnce(`${origin}/ffmpeg/util.js`);
    if (!window.FFmpegWASM || !window.FFmpegUtil) throw new Error('Audio converter unavailable.');
    const { FFmpeg } = window.FFmpegWASM;
    const ff = new FFmpeg();
    ff.on('log', () => {}); // registering a log listener stabilizes the worker handshake
    try {
      await ff.load({
        coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
        wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
      });
    } catch (e) {
      __ffmpegPromise = null;
      throw new Error('converter failed to initialize' + (e && e.message ? ': ' + e.message : (e ? ': ' + String(e) : '')));
    }
    return ff;
  })().catch((e) => { __ffmpegPromise = null; throw e; });
  return __ffmpegPromise;
}
export async function transcodeAudioToMp3(file, onProgress) {
  const ff = await getFfmpeg();
  const { fetchFile } = window.FFmpegUtil;
  const stamp = Date.now();
  const inName = `in_${stamp}`;
  const outName = `out_${stamp}.mp3`;
  const logs = [];
  const onLog = (e) => { const m = e && e.message; if (m) { logs.push(m); if (logs.length > 40) logs.shift(); } };
  const onProg = ({ progress }) => { if (onProgress) onProgress(Math.max(0, Math.min(99, Math.round((progress || 0) * 100)))); };
  const tail = () => logs.slice(-3).join(' | ').slice(0, 240);
  ff.on('log', onLog);
  ff.on('progress', onProg);
  try {
    let bytes;
    try { bytes = await fetchFile(file); } catch (e) { throw new Error('could not read the file' + (e && e.message ? ': ' + e.message : '')); }
    if (!bytes || !bytes.length) throw new Error('the file appears to be empty');
    await ff.writeFile(inName, bytes);
    // 16 kHz mono, 32 kbps MP3 — ideal for speech/Whisper, keeps long calls small
    let code;
    try {
      code = await ff.exec(['-i', inName, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '32k', outName]);
    } catch (e) {
      throw new Error(`converter crashed${e && e.message ? ' (' + e.message + ')' : ''}${tail() ? ' — ' + tail() : ''}`);
    }
    if (typeof code === 'number' && code !== 0) {
      throw new Error(`converter exited ${code}${tail() ? ' — ' + tail() : ''}`);
    }
    let data;
    try { data = await ff.readFile(outName); }
    catch (e) { throw new Error(`no output produced${tail() ? ' — ' + tail() : ''}`); }
    if (!data || !data.length) throw new Error(`produced an empty file${tail() ? ' — ' + tail() : ''}`);
    const baseName = (file.name || 'recording').replace(/\.[^.]+$/, '') || 'recording';
    return new File([data], `${baseName}.mp3`, { type: 'audio/mpeg' });
  } finally {
    try { ff.off('log', onLog); } catch (_) {}
    try { ff.off('progress', onProg); } catch (_) {}
    try { await ff.deleteFile(inName); } catch (_) {}
    try { await ff.deleteFile(outName); } catch (_) {}
  }
}

export async function resumableUpload({ bucket, path, file, onProgress }) {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session && session.access_token;
  if (!accessToken) throw new Error('Not signed in');
  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 4000, 8000, 16000, 30000],
      headers: { authorization: `Bearer ${accessToken}`, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: bucket, objectName: path, contentType: file.type || 'application/octet-stream' },
      onError: (e) => reject(e),
      onProgress: (sent, total) => { if (onProgress && total) onProgress(sent / total); },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}
