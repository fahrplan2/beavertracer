//@ts-check

/**
 * Simulation-wide audio output.
 *
 * Everything that makes sound (softphone ringtones, RTP playback, …) shares one
 * AudioContext and one master gain node so that:
 *   - the browser autoplay gate is cleared once, from any gesture anywhere in
 *     the simulator — starting the sim already counts;
 *   - there is a single place for master mute / volume.
 *
 * Mirrors the `simTimer` singleton. In a non-DOM environment (tests) every
 * method is a safe no-op until an AudioContext constructor is supplied.
 */
export class SimAudio {

  /** @param {{ AudioContextCtor?: any }} [opts] */
  constructor(opts = {}) {
    this._Ctor = opts.AudioContextCtor ?? (
      typeof window !== "undefined"
        ? (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)
        : null
    );
    /** @type {AudioContext|null} */ this._ac = null;
    /** @type {GainNode|null} */ this._master = null;
    this._muted = false;
    this._volume = 0.8;
    /** @type {(() => void)|undefined} */ this._detachUnlock = undefined;
    this._armUnlock();
  }

  /** Resume the context on the first user interaction anywhere in the app. */
  _armUnlock() {
    if (this._detachUnlock) return;
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    const fn = () => { void this.unlock(); };
    const events = ["pointerdown", "keydown", "touchstart"];
    for (const ev of events) document.addEventListener(ev, fn, { capture: true, passive: true });
    this._detachUnlock = () => {
      for (const ev of events) document.removeEventListener(ev, fn, { capture: true });
      this._detachUnlock = undefined;
    };
  }

  /**
   * Create (if needed) and resume the context. Safe to call repeatedly and from
   * any gesture handler.
   * @returns {Promise<boolean>} whether the context is now running
   */
  async unlock() {
    let ac = this._ac;
    if (!ac) {
      if (!this._Ctor) return false;
      try {
        ac = /** @type {AudioContext} */ (new this._Ctor());
        const master = ac.createGain();
        master.gain.value = this._muted ? 0 : this._volume;
        master.connect(ac.destination);
        this._ac = ac;
        this._master = master;
      } catch { this._ac = null; this._master = null; return false; }
    }
    if (ac.state === "suspended") {
      try { await ac.resume(); } catch { /* needs a genuine gesture */ }
    }
    const ok = ac.state === "running";
    if (ok && this._detachUnlock) this._detachUnlock();
    return ok;
  }

  get ready() { return !!this._ac && this._ac.state === "running"; }
  get state() { return this._ac ? this._ac.state : "none"; }
  get context() { return this._ac; }
  /** Master gain node — connect app audio here, not to destination directly. */
  get out() { return this._master; }
  get sampleRate() { return this._ac ? this._ac.sampleRate : 48000; }

  get muted() { return this._muted; }
  /** @param {boolean} b */
  setMuted(b) {
    this._muted = !!b;
    if (this._master) this._master.gain.value = this._muted ? 0 : this._volume;
  }

  get volume() { return this._volume; }
  /** @param {number} v 0..1 */
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._master && !this._muted) this._master.gain.value = this._volume;
  }

  /** @param {ArrayBuffer} data @returns {Promise<AudioBuffer|null>} */
  async decode(data) {
    if (!this._ac) return null;
    try { return await this._ac.decodeAudioData(data); }
    catch { return null; }
  }

  /**
   * Empty buffer for the caller to fill (e.g. talkspurt reconstruction).
   * @param {number} channels @param {number} length @param {number} sampleRate
   * @returns {AudioBuffer|null}
   */
  createBuffer(channels, length, sampleRate) {
    return this._ac ? this._ac.createBuffer(channels, length, sampleRate) : null;
  }

  /**
   * Play a short tone burst / chord.
   * @param {object} o
   * @param {number[]} o.freqs
   * @param {number} o.durationS
   * @param {number} [o.level] peak gain (default 0.2)
   * @param {number} [o.at] context time (default: now)
   * @param {"sine"|"square"|"triangle"|"sawtooth"} [o.type] oscillator wave (default "sine")
   * @param {number} [o.warbleHz] if > 0, frequency-modulate the tone at this rate (telephone "warble")
   * @param {number} [o.warbleDepth] warble depth in Hz (default 45)
   */
  tone({ freqs, durationS, level = 0.2, at, type = "sine", warbleHz = 0, warbleDepth = 45 }) {
    const ac = this._ac;
    if (!ac || !this._master || ac.state !== "running") return;
    const t0 = at ?? ac.currentTime + 0.01;
    const end = t0 + durationS;

    // linear ramps only — exponential ramps throw on non-positive values in Firefox
    const g = ac.createGain();
    g.connect(this._master);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.012);
    g.gain.setValueAtTime(level, end);
    g.gain.linearRampToValueAtTime(0, end + 0.03);

    let warble = null;
    if (warbleHz > 0) {
      const lfo = ac.createOscillator();
      lfo.type = "square";
      lfo.frequency.value = warbleHz;
      warble = ac.createGain();
      warble.gain.value = warbleDepth;
      lfo.connect(warble);
      lfo.start(t0);
      lfo.stop(end + 0.1);
    }

    for (const f of freqs) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      if (warble) warble.connect(o.frequency);
      o.connect(g);
      o.start(t0);
      o.stop(end + 0.1);
    }
  }

  /**
   * Play an AudioBuffer through the master bus.
   * @param {AudioBuffer} buffer
   * @returns {AudioBufferSourceNode|null}
   */
  playBuffer(buffer) {
    const ac = this._ac;
    if (!ac || !this._master || ac.state !== "running") return null;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(this._master);
    src.start();
    return src;
  }

  /** A short burst of white noise (a "glitch" cue for a lossy talkspurt). @param {{durationS:number, level?:number}} o */
  noise({ durationS, level = 0.1 }) {
    const ac = this._ac;
    if (!ac || !this._master || ac.state !== "running") return;
    const n = Math.max(1, Math.floor(durationS * ac.sampleRate));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * level;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(this._master);
    src.start();
  }

  /** Whether the browser can speak (Web Speech API present). */
  get canSpeak() {
    return typeof window !== "undefined"
      && typeof window.speechSynthesis !== "undefined"
      && typeof window.SpeechSynthesisUtterance !== "undefined";
  }

  /**
   * Speak text via the browser's TTS. Not routed through the AudioContext
   * (the Web Speech API has no such hook), but honours master mute and scales
   * roughly by master volume.
   * @param {string} text
   * @param {{ lang?: string, volume?: number, rate?: number, pitch?: number }} [o]
   * @returns {boolean} whether speech was dispatched
   */
  speak(text, { lang = "en", volume = 1, rate = 1, pitch = 1 } = {}) {
    if (this._muted) return true; // handled — just silent
    if (!this.canSpeak) return false;
    try {
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.volume = Math.max(0, Math.min(1, volume * this._volume));
      u.rate = rate;
      u.pitch = pitch;
      window.speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  }

  /** Stop any in-progress speech (call on hang-up). */
  cancelSpeech() {
    if (this.canSpeak) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  }
}

export const simAudio = new SimAudio();
