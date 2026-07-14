/* ============================================================
   Audio (tiny synth)
============================================================ */
let AC = null;
export function audioCtx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  return AC;
}

export function beep(f, f2, dur, type, vol) {
  try {
    const a = audioCtx();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch (e) { /* audio unavailable */ }
}

/* punchy sci-fi laser zap: two detuned saws swept down through a bandpass */
export function laserSfx(vol = 0.06, startF = 1800) {
  try {
    const a = audioCtx();
    const t = a.currentTime;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    const f = a.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(startF * 1.2, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    for (const det of [0, 12]) {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(startF, t);
      o.frequency.exponentialRampToValueAtTime(startF * 0.09, t + 0.11);
      o.connect(f);
      o.start(t); o.stop(t + 0.12);
    }
    f.connect(g).connect(a.destination);
  } catch (e) { /* audio unavailable */ }
}

/* ============================================================
   Background music — "Rocky Musicloop" by johndekale (CC0)
   https://opengameart.org/content/rocky-musicloop
============================================================ */
let musicBuf = null, musicSrc = null, musicGain = null;

export async function startMusic() {
  try {
    const a = audioCtx();
    if (!musicBuf) {
      const res = await fetch('assets/rocky-musicloop.mp3');
      musicBuf = await a.decodeAudioData(await res.arrayBuffer());
    }
    if (musicSrc) return;
    musicGain = a.createGain();
    musicGain.gain.value = 0.3;
    musicSrc = a.createBufferSource();
    musicSrc.buffer = musicBuf;
    musicSrc.loop = true;
    musicSrc.connect(musicGain).connect(a.destination);
    musicSrc.start();
  } catch (e) { /* audio unavailable */ }
}

/* fade the music down, e.g. on the end screen */
export function duckMusic() {
  if (!musicGain) return;
  const a = audioCtx();
  musicGain.gain.setValueAtTime(musicGain.gain.value, a.currentTime);
  musicGain.gain.linearRampToValueAtTime(0.08, a.currentTime + 1.5);
}

export function boomSfx(vol, dur) {
  try {
    const a = audioCtx();
    const src = a.createBufferSource();
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    src.buffer = buf;
    const g = a.createGain(); g.gain.value = vol;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  } catch (e) { /* audio unavailable */ }
}
