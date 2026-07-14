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
