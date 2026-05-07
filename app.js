import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
const FF_BASE   = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm';

const dropEl = document.getElementById('drop');
const fileEl = document.getElementById('file');
const nameEl = document.getElementById('name');
const goEl   = document.getElementById('go');
const statusEl = document.getElementById('status');
const barEl  = document.getElementById('bar-fill');
const msgEl  = document.getElementById('msg');

let ffmpeg = null;
let pickedFile = null;

function safeName(s) {
  const cleaned = (s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toUpperCase();
  return cleaned || 'SONG';
}

function setStatus(text, kind = '', progress = null) {
  statusEl.hidden = false;
  msgEl.textContent = text;
  msgEl.className = kind;
  if (progress !== null) barEl.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
}

function setFile(file) {
  pickedFile = file;
  goEl.disabled = !file;
  if (!file) return;
  const stem = file.name.replace(/\.[^.]+$/, '');
  nameEl.value = safeName(stem);
  setStatus(`Loaded: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);
}

dropEl.addEventListener('click', () => fileEl.click());
fileEl.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});
['dragenter', 'dragover'].forEach(ev =>
  dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('drag'); })
);
['dragleave', 'drop'].forEach(ev =>
  dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('drag'); })
);
dropEl.addEventListener('drop', e => {
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});

nameEl.addEventListener('input', () => {
  const cursor = nameEl.selectionStart;
  nameEl.value = nameEl.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16);
  nameEl.setSelectionRange(cursor, cursor);
});

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  setStatus('Loading converter (~30 MB, first run only)…', '', 0);
  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    // optional: console.debug(message);
  });
  ffmpeg.on('progress', ({ progress }) => {
    if (progress > 0 && progress <= 1) {
      setStatus(`Converting… ${Math.round(progress * 100)}%`, '', progress);
    }
  });
  await ffmpeg.load({
    classWorkerURL: await toBlobURL(`${FF_BASE}/worker.js`, 'text/javascript'),
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ffmpeg;
}

goEl.addEventListener('click', async () => {
  if (!pickedFile) return;
  goEl.disabled = true;
  barEl.style.width = '0%';

  const outName = safeName(nameEl.value || pickedFile.name);
  nameEl.value = outName;

  try {
    const ff = await loadFFmpeg();

    const inExt = (pickedFile.name.match(/\.([^.]+)$/) || [])[1] || 'bin';
    const inPath = `input.${inExt.toLowerCase()}`;
    const outPath = 'output.wav';

    setStatus('Reading file…', '', 0.02);
    await ff.writeFile(inPath, await fetchFile(pickedFile));

    setStatus('Converting…', '', 0.05);
    const code = await ff.exec([
      '-i', inPath,
      '-vn',
      '-ar', '44100',
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      outPath,
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);

    const data = await ff.readFile(outPath);
    const blob = new Blob([data.buffer], { type: 'audio/wav' });

    try { await ff.deleteFile(inPath); } catch {}
    try { await ff.deleteFile(outPath); } catch {}

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${outName}.WAV`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);

    setStatus(`Done. Saved ${outName}.WAV (${(blob.size / 1048576).toFixed(1)} MB). Copy to FAT32 USB root.`, 'ok', 1);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message || err}`, 'err');
  } finally {
    goEl.disabled = false;
  }
});
