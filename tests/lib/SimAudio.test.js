import { describe, it, expect, beforeEach } from 'vitest';
import { SimAudio } from '../../src/lib/SimAudio.js';

/** Minimal AudioContext stand-in (vitest runs in node). */
function makeFakeAC() {
  const nodes = { gains: 0, oscs: 0, sources: 0, buffers: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {},
  });
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 48000,
    destination: { _isDest: true },
    async resume() { this.state = 'running'; },
    createGain() { nodes.gains++; return { gain: param(), connect() {}, disconnect() {} }; },
    createOscillator() { nodes.oscs++; return { type: 'sine', frequency: param(), connect() {}, start() {}, stop() {} }; },
    createBufferSource() { nodes.sources++; return { buffer: null, connect() {}, start() {} }; },
    createBuffer(ch, len) { nodes.buffers++; return { numberOfChannels: ch, length: len, duration: len / 48000, getChannelData: () => new Float32Array(len) }; },
    async decodeAudioData() { return this.createBuffer(1, 4800); },
  };
  return { ctx, nodes };
}

let fake, audio;
beforeEach(() => {
  fake = makeFakeAC();
  audio = new SimAudio({ AudioContextCtor: function () { return fake.ctx; } });
});

describe('SimAudio', () => {
  it('is a no-op until unlocked', () => {
    expect(audio.ready).toBe(false);
    expect(audio.context).toBe(null);
    audio.tone({ freqs: [440], durationS: 0.2 });     // must not throw
    expect(audio.playBuffer(/** @type {any} */ ({}))).toBe(null);
    expect(fake.nodes.oscs).toBe(0);
  });

  it('creates and resumes the context on unlock()', async () => {
    const ok = await audio.unlock();
    expect(ok).toBe(true);
    expect(audio.ready).toBe(true);
    expect(audio.context).toBe(fake.ctx);
    expect(audio.sampleRate).toBe(48000);
  });

  it('routes tones and buffers through a master gain, not the destination', async () => {
    await audio.unlock();
    expect(fake.nodes.gains).toBe(1);                 // the master
    audio.tone({ freqs: [440, 480], durationS: 0.3 });
    expect(fake.nodes.gains).toBe(2);                 // per-burst envelope gain
    expect(fake.nodes.oscs).toBe(2);
    const src = audio.playBuffer(/** @type {any} */ ({}));
    expect(src).not.toBe(null);
    expect(fake.nodes.sources).toBe(1);
  });

  it('applies mute / volume to the master gain', async () => {
    await audio.unlock();
    audio.setVolume(0.5);
    expect(audio.volume).toBe(0.5);
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    audio.setVolume(1.5);                             // clamped
    expect(audio.volume).toBe(1);
  });

  it('decode() yields an AudioBuffer once unlocked, null before', async () => {
    expect(await audio.decode(new ArrayBuffer(8))).toBe(null);
    await audio.unlock();
    const b = await audio.decode(new ArrayBuffer(8));
    expect(b).toBeTruthy();
  });

  it('reports no speech synthesis in a non-DOM environment', () => {
    expect(audio.canSpeak).toBe(false);
    expect(audio.speak('hello', { lang: 'en' })).toBe(false);
  });

  it('speak() is a silent no-op (returns handled) when muted', () => {
    audio.setMuted(true);
    expect(audio.speak('hello')).toBe(true);
  });

  it('noise() is a no-op before unlock and creates a buffer after', async () => {
    audio.noise({ durationS: 0.1 });
    expect(fake.nodes.buffers).toBe(0);
    await audio.unlock();
    audio.noise({ durationS: 0.1 });
    expect(fake.nodes.buffers).toBe(1);
    expect(fake.nodes.sources).toBe(1);
  });
});
