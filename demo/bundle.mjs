// synth.mjs
var PERSONA_STAGES = [
  { id: "Rut", position: 0, partials: 2 },
  { id: "Emerging", position: 1 / 3, partials: 4 },
  { id: "Growing", position: 2 / 3, partials: 8 },
  { id: "Taste", position: 1, partials: 16 }
];
var WAVETABLE_INTENSITY = 2.6;
var WAVETABLE_CURVE = 1.2;
var PERSONA_CHORDS = { Rut: [0, 1], Emerging: [0, 1, 7], Growing: [0, 2, 7], Taste: [0, 1, 4, 7] };
var MIN_FUNDAMENTAL = 50;
var MAX_FUNDAMENTAL = 440;
var MIN_PARTIALS = PERSONA_STAGES.reduce((m, s) => Math.min(m, s.partials), Infinity);
var MAX_PARTIALS = PERSONA_STAGES.reduce((m, s) => Math.max(m, s.partials), -Infinity);
var MASTER_GAIN_DEFAULT = 0.25;
var PREDRIVE_GAIN_DEFAULT = 1;
var DISTORTION_DEFAULT_AMOUNT = 40;
var DISTORTION_FALLBACK_K = 10;
var DISTORTION_SAMPLE_COUNT = 44100;
var DISTORTION_INPUT_SCALE = 2.5;
var DISTORTION_BASE_OFFSET = 5;
var DISTORTION_GAIN_MULTIPLIER = 30;
var DEG_TO_RAD = Math.PI / 180;
var WAVETABLE_INITIAL_POS = 0;
var TWO_PI = Math.PI * 2;
var DELAY_MAX_TIME = 3;
var DELAY_RANDOM_BASE = 0.08;
var FEEDBACK_INITIAL_GAIN = 0;
var REFINEMENT_INITIAL = 0.5;
var COUPLING_INITIAL = 0;
var STATE_LAG_DEFAULT = 0.01;
var TURBULENCE_MIN_ENTROPY = 0.01;
var TURBULENCE_BASE_FREQ1 = 0.4;
var TURBULENCE_SCALE_FREQ1 = 0.8;
var TURBULENCE_BASE_FREQ2 = 0.2;
var TURBULENCE_SCALE_FREQ2 = 0.6;
var TURBULENCE_PHASE_OFFSET2 = 1.3;
var TURBULENCE_OUTPUT_SCALE = 0.5;
var ROOT_MIN_HZ = 20;
var ROOT_MAX_HZ = 2e3;
var RICHNESS_BASE_FACTOR = 0.8;
var RICHNESS_SCALE_FACTOR = 0.4;
var DETUNE_SPREAD = 0.05;
var ENTROPY_JITTER_SCALE = 4;
var FREQ_LAG_TIME = 0.05;
var REFINEMENT_MIN_CUTOFF = 400;
var REFINEMENT_MAX_CUTOFF = 8e3;
var REFINEMENT_MIN_Q = 0.7;
var REFINEMENT_MAX_Q = 8;
var REFINEMENT_CUTOFF_MIN = 200;
var REFINEMENT_CUTOFF_MAX = 12e3;
var FILTER_TIME_CONST = 0.1;
var FILTER_Q_TIME_CONST = 0.1;
var ENTROPY_TURB_THRESHOLD = 0.01;
var TURBULENCE_MOD_SCALE = 0.35;
var TURBULENCE_Q_SCALE = 0.2;
var DELAY_MIN_TIME = 0.02;
var DELAY_TIME_SCALE = 1.5;
var FEEDBACK_MIN = 0;
var FEEDBACK_MAX = 0.35;
var DELAY_TIME_CONST = 0.1;
var FEEDBACK_TIME_CONST = 0.2;
var DRIVE_MIN = 1;
var DRIVE_MAX = 24;
var DRIVE_TIME_CONST = 0.05;
var LAG_BASE = 0.01;
var LAG_SCALE = 0.3;
var SEMITONES_PER_OCTAVE = 12;
var PersonaWavetableSynth = class {
  constructor(audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = audioContext || new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN_DEFAULT;
    this.preDrive = this.ctx.createGain();
    this.preDrive.gain.value = PREDRIVE_GAIN_DEFAULT;
    this.waveShaper = this.ctx.createWaveShaper();
    this.waveShaper.curve = this._makeDistortionCurve(DISTORTION_DEFAULT_AMOUNT);
    this.waveShaper.oversample = "4x";
    this.wavetablePos = WAVETABLE_INITIAL_POS;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.delay = this.ctx.createDelay(DELAY_MAX_TIME);
    this.feedback = this.ctx.createGain();
    this.master.connect(this.preDrive);
    this.preDrive.connect(this.waveShaper);
    this.waveShaper.connect(this.filter);
    this.filter.connect(this.ctx.destination);
    this.filter.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.ctx.destination);
    this.delay.delayTime.value = Math.random() * DELAY_RANDOM_BASE;
    this.feedback.gain.value = FEEDBACK_INITIAL_GAIN;
    this.personas = [];
    this._weights = new Array(PERSONA_STAGES.length).fill(0);
    this.value = 0;
    this._richnessNorm = 0;
    this.baseNoteHz = (MIN_FUNDAMENTAL + MAX_FUNDAMENTAL) * 0.5;
    this._fundamental = this.baseNoteHz;
    this.entropyAmount = 0;
    this.refinementAmount = REFINEMENT_INITIAL;
    this.coupling = COUPLING_INITIAL;
    this.stateLag = STATE_LAG_DEFAULT;
    this._turbPhase1 = Math.random() * TWO_PI;
    this._turbPhase2 = Math.random() * TWO_PI;
    PERSONA_STAGES.forEach((stage) => {
      const personaGain = this.ctx.createGain();
      personaGain.gain.value = 0;
      personaGain.connect(this.master);
      const voices = [];
      const semis = PERSONA_CHORDS[stage.id] || [0];
      const count = semis.length || 1;
      semis.forEach((semi) => {
        const ratio = Math.pow(2, semi / SEMITONES_PER_OCTAVE);
        const osc = this.ctx.createOscillator();
        const wave = this._buildWave(stage.partials);
        osc.setPeriodicWave(wave);
        osc.frequency.value = this._fundamental * ratio;
        const voiceGain = this.ctx.createGain();
        voiceGain.gain.value = 1 / count;
        osc.connect(voiceGain).connect(personaGain);
        osc.start();
        voices.push({ osc, ratio, gain: voiceGain });
      });
      this.personas.push({ stage, gain: personaGain, voices });
    });
    this.setValue(0);
    this._applyRefinement();
  }
  setWavetablePos(amount) {
    const a = Math.min(1, Math.max(0, amount));
    this.wavetablePos = a;
    this._updateWaves();
  }
  _updateWaves() {
    const pos = this.wavetablePos;
    this.personas.forEach((p) => {
      const wave = this._buildWave(p.stage.partials, pos);
      p.voices.forEach((v) => {
        v.osc.setPeriodicWave(wave);
      });
    });
  }
  _buildWave(partials, pos = this.wavetablePos || 0) {
    pos = Math.min(1, Math.max(0, pos));
    let p = Math.pow(pos, WAVETABLE_CURVE);
    p = 0.1 + (p - 0.5) * WAVETABLE_INTENSITY;
    p = Math.min(1, Math.max(0, p));
    const real = new Float32Array(partials + 1);
    const imag = new Float32Array(partials + 1);
    real[0] = 0;
    for (let n = 1; n <= partials; n++) {
      const sineAmp = n === 1 ? 1 : 0;
      const triAmp = n % 2 === 1 ? (n % 4 === 1 ? 1 : -1) / (n * n) : 0;
      const sawAmp = 1 / n;
      const brightBoost = 1 + 3 * (n / partials);
      const brightAmp = 1 / n * brightBoost;
      let a1;
      if (p < 1 / 3) {
        const t = p / (1 / 3);
        a1 = sineAmp * (1 - t) + triAmp * t;
      } else if (p < 2 / 3) {
        const t = (p - 1 / 3) / (1 / 3);
        a1 = triAmp * (1 - t) + sawAmp * t;
      } else {
        const t = (p - 2 / 3) / (1 / 3);
        a1 = sawAmp * (1 - t) + brightAmp * t;
      }
      real[n] = 0;
      imag[n] = a1;
    }
    return this.ctx.createPeriodicWave(real, imag);
  }
  _makeDistortionCurve(amount) {
    const k = typeof amount === "number" ? amount : DISTORTION_FALLBACK_K;
    const n = DISTORTION_SAMPLE_COUNT;
    const curve = new Float32Array(n);
    const deg = DEG_TO_RAD;
    for (let i = 0; i < n; i++) {
      const x = i * DISTORTION_INPUT_SCALE / n - 1;
      curve[i] = (DISTORTION_BASE_OFFSET + k) * x * DISTORTION_GAIN_MULTIPLIER * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }
  _getTurbulenceShape() {
    const e = this.entropyAmount;
    if (e <= TURBULENCE_MIN_ENTROPY) return 0;
    const t = this.ctx.currentTime;
    const s1 = TURBULENCE_BASE_FREQ1 + TURBULENCE_SCALE_FREQ1 * e;
    const s2 = TURBULENCE_BASE_FREQ2 + TURBULENCE_SCALE_FREQ2 * e;
    const a = Math.sin(t * s1 + this._turbPhase1) + Math.sin(t * s2 + this._turbPhase2 + TURBULENCE_PHASE_OFFSET2);
    return TURBULENCE_OUTPUT_SCALE * a;
  }
  setRootHz(hz) {
    const h = Number(hz);
    if (!isFinite(h)) return;
    const clamped = Math.max(ROOT_MIN_HZ, Math.min(ROOT_MAX_HZ, h));
    this.baseNoteHz = clamped;
    this._updateSpectralParameters();
  }
  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }
  async pause() {
    if (this.ctx.state === "running") await this.ctx.suspend();
  }
  setValue(t) {
    const clamped = Math.min(1, Math.max(0, t));
    this.value = clamped;
    this._updateMix(clamped);
  }
  _updateMix(t) {
    const stages = this.personas;
    const width = 1 / (stages.length - 1);
    let weights = stages.map((p) => {
      const center = p.stage.position;
      const distance = Math.abs(t - center);
      return Math.max(1 - distance / width, 0);
    });
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    weights = weights.map((w) => w / sum);
    if (this.coupling > 0) {
      const coupled = new Array(weights.length).fill(0);
      for (let i = 0; i < weights.length; i++) {
        let self = weights[i];
        let neighbors = 0;
        let count = 0;
        if (i > 0) {
          neighbors += weights[i - 1];
          count++;
        }
        if (i < weights.length - 1) {
          neighbors += weights[i + 1];
          count++;
        }
        const neighborAvg = count ? neighbors / count : self;
        coupled[i] = (1 - this.coupling) * self + this.coupling * neighborAvg;
      }
      weights = coupled;
    }
    this._weights = weights;
    const now = this.ctx.currentTime;
    this.personas.forEach((p, i) => {
      const target = this._weights[i];
      p.gain.gain.setTargetAtTime(target, now, this.stateLag);
    });
    this._updateSpectralParameters();
  }
  _updateSpectralParameters() {
    let partialWeighted = 0;
    for (let i = 0; i < PERSONA_STAGES.length; i++) {
      partialWeighted += (this._weights[i] || 0) * PERSONA_STAGES[i].partials;
    }
    if (!isFinite(partialWeighted)) partialWeighted = MIN_PARTIALS;
    const denom = Math.max(1, MAX_PARTIALS - MIN_PARTIALS);
    const richnessNorm = (partialWeighted - MIN_PARTIALS) / denom;
    const base = this.baseNoteHz || (MIN_FUNDAMENTAL + MAX_FUNDAMENTAL) * 0.5;
    const factor = RICHNESS_BASE_FACTOR + RICHNESS_SCALE_FACTOR * richnessNorm;
    const fundamental = base * factor;
    this._richnessNorm = richnessNorm;
    this._fundamental = fundamental;
    const now = this.ctx.currentTime;
    const detuneSpread = DETUNE_SPREAD;
    this.personas.forEach((p, i) => {
      const centerIndex = (PERSONA_STAGES.length - 1) / 2;
      const offset = i - centerIndex;
      const personaRatio = 1 + detuneSpread * offset;
      const baseJitter = (Math.random() - 0.5) * this.entropyAmount * ENTROPY_JITTER_SCALE;
      p.voices.forEach((v) => {
        const localJitter = baseJitter + (Math.random() - 0.5) * this.entropyAmount;
        const f = fundamental * personaRatio * v.ratio + localJitter;
        v.osc.frequency.setTargetAtTime(f, now, FREQ_LAG_TIME);
      });
    });
    this._applyRefinement();
  }
  _applyRefinement() {
    const now = this.ctx.currentTime;
    const a = this.refinementAmount;
    const minCutoff = REFINEMENT_MIN_CUTOFF;
    const maxCutoff = REFINEMENT_MAX_CUTOFF;
    let cutoff = minCutoff + (maxCutoff - minCutoff) * a;
    const minQ = REFINEMENT_MIN_Q;
    let maxQ = REFINEMENT_MAX_Q;
    const shape = this._getTurbulenceShape();
    if (this.entropyAmount > ENTROPY_TURB_THRESHOLD) {
      const e = this.entropyAmount;
      const mod = 1 + TURBULENCE_MOD_SCALE * shape * e;
      cutoff *= mod;
      maxQ *= 1 + TURBULENCE_Q_SCALE * shape * e;
    }
    cutoff = Math.max(REFINEMENT_CUTOFF_MIN, Math.min(REFINEMENT_CUTOFF_MAX, cutoff));
    this.filter.frequency.setTargetAtTime(cutoff, now, FILTER_TIME_CONST);
    this.filter.Q.setTargetAtTime(minQ + (maxQ - minQ) * a, now, FILTER_Q_TIME_CONST);
  }
  setDelay(amount) {
    const a = Math.min(1, Math.max(0, amount));
    const now = this.ctx.currentTime;
    const delayTime = DELAY_MIN_TIME + DELAY_TIME_SCALE * a;
    const shaped = a * a;
    const fbMin = FEEDBACK_MIN;
    const fbMax = FEEDBACK_MAX;
    const feedbackGain = fbMin + (fbMax - fbMin) * shaped;
    this.delay.delayTime.setTargetAtTime(delayTime, now, DELAY_TIME_CONST);
    this.feedback.gain.setTargetAtTime(feedbackGain, now, FEEDBACK_TIME_CONST);
  }
  setEntropy(amount) {
    const a = Math.min(1, Math.max(0, amount));
    this.entropyAmount = a;
    this._updateSpectralParameters();
    const now = this.ctx.currentTime;
    const minDrive = DRIVE_MIN;
    const maxDrive = DRIVE_MAX;
    const drive = minDrive + (maxDrive - minDrive) * a;
    this.preDrive.gain.setTargetAtTime(drive, now, DRIVE_TIME_CONST);
  }
  setRefinement(amount) {
    this.refinementAmount = Math.min(1, Math.max(0, amount));
    this._applyRefinement();
  }
  setLag(amount) {
    this.stateLag = LAG_BASE + LAG_SCALE * Math.min(1, Math.max(0, amount));
  }
  setCoupling(amount) {
    this.coupling = Math.min(1, Math.max(0, amount));
    this._updateMix(this.value);
  }
  getState() {
    const weights = this._weights.slice();
    let maxIdx = 0;
    for (let i = 1; i < weights.length; i++) {
      if (weights[i] > weights[maxIdx]) maxIdx = i;
    }
    return {
      value: this.value,
      weights,
      dominant: this.personas[maxIdx].stage,
      richnessNorm: this._richnessNorm,
      fundamental: this._fundamental,
      wavetablePos: this.wavetablePos
    };
  }
  dispose() {
    this.personas.forEach((p) => {
      p.voices.forEach((v) => {
        try {
          v.osc.stop();
        } catch (_) {
        }
      });
    });
    this.ctx.close();
  }
};

// visualizer.mjs
var STATE_COLORS = {
  rut: "#2200ffff",
  emerging: "#f51870ff",
  growing: "#13d266ff",
  taste: "#fffcebff"
};
var HEX_SHORT_LENGTH = 3;
var COLOR_COMPONENT_MAX = 255;
var INITIAL_GLOBAL_ALPHA = 0.1;
var INITIAL_REFINEMENT = 0.5;
var ENERGY_DEFAULT = 0.5;
var BG_TOP_COLOR = "#000000";
var BG_MID_COLOR = "#001528";
var BG_BOTTOM_COLOR = "#000000";
var BG_MID_STOP = 0.4;
var GRID_LINE_COLOR = "rgba(0, 120, 255, 0.25)";
var GRID_LINE_WIDTH = 1;
var GRID_LINE_WIDTH_ENERGY_SCALE = 5.05;
var GRID_ALPHA_BASE = 0.15;
var GRID_ALPHA_ENERGY_SCALE = 0.85;
var HORIZON_Y_FACTOR = 0.3;
var VANISHING_X_FACTOR = 0.5;
var GRID_NUM_LINES = 24;
var TRAIL_MAX_FRAMES = 12;
var TRAIL_BASE_GRAVITY = 0.6;
var TRAIL_GRAVITY_SCALE = 5.2;
var TRAIL_BASE_VELOCITY = 15;
var TRAIL_GRAVITY_PIXEL_SCALE = 200;
var TRAIL_BASE_ALPHA = 0.25;
var TRAIL_ALPHA_DECAY = 0.25;
var TRAIL_ALPHA_BIAS = 0.4;
var TRAIL_MAX_HEIGHT_MULTIPLIER = 2;
var TRAIL_ECHO_COUNT = 3;
var TRAIL_ECHO_OFFSET_X = 6;
var TRAIL_ECHO_OFFSET_Y = 4;
var TRAIL_ECHO_ALPHA_SCALE = 0.6;
var NOISE_MIN_ENTROPY = 0.01;
var NOISE_COUNT_SCALE = 200;
var NOISE_BASE_ALPHA = 0.2;
var NOISE_ALPHA_SCALE = 0.25;
var NOISE_FILL_COLOR = "#ffffff";
var NOISE_MIN_SIZE = 0.7;
var NOISE_SIZE_RANGE = 1.8;
var NOISE_ENERGY_BASE = 0.3;
var NOISE_ENERGY_SCALE = 0.7;
var SQUISH_MIN_ENTROPY = 0.01;
var SQUISH_FREQ1_BASE = 0.6;
var SQUISH_FREQ1_SCALE = 1;
var SQUISH_FREQ2_BASE = 0.3;
var SQUISH_FREQ2_SCALE = 0.7;
var SQUISH_PHASE_OFFSET = 1.7;
var SQUISH_OUTPUT_SCALE = 0.5;
var MS_TO_SECONDS = 1e3;
var MIN_LINES = 3;
var MAX_LINES = 28;
var MIN_CYCLES = 2;
var MAX_CYCLES = 10;
var TOP_Y_FACTOR = 0.19;
var STACK_HEIGHT_FACTOR = 0.55;
var BASE_AMP_FACTOR = 0.1;
var SAMPLE_COUNT = 400;
var REFINEMENT_BOOST_BASE = 0.2;
var REFINEMENT_BOOST_SCALE = 0.8;
var SATURATION_BASE_SCALE = 0.7;
var SATURATION_BLEND_BASE = 0.4;
var SATURATION_BLEND_SCALE = 0.6;
var LIGHTNESS_BASE_SCALE = 0.7;
var LIGHTNESS_BLEND_SCALE = 0.3;
var LINE_WIDTH = 2;
var DEPTH_AMP_BASE = 0.3;
var DEPTH_AMP_SCALE = 0.9;
var SQUISH_AMP_REDUCTION = 0.35;
var ALPHA_BASE = 0.25;
var ALPHA_DEPTH_SCALE = 0.75;
var SHADOW_BLUR_BASE = 10;
var SHADOW_BLUR_SCALE = 10;
var CYCLES_TIME_SCALE = 2;
var CYCLES_DEPTH_OFFSET = 0.8;
var SQUISH_DEPTH_TIME_SCALE = 0.4;
var POS_CENTER = 0.5;
var BRIGHT_BOOST_SCALE = 3;
var JITTER_PHASE_SCALE = 0.5;
var TIME_FREQ_SCALE = 1.5;
var TWO_PI2 = Math.PI * 2;
function hexToHsl(hex) {
  let h = hex.replace("#", "");
  if (h.length === HEX_SHORT_LENGTH) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / COLOR_COMPONENT_MAX;
  const g = parseInt(h.slice(2, 4), 16) / COLOR_COMPONENT_MAX;
  const b = parseInt(h.slice(4, 6), 16) / COLOR_COMPONENT_MAX;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hh, s, l;
  l = (max + min) / 2;
  if (max === min) {
    hh = 0;
    s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hh = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hh = (b - r) / d + 2;
        break;
      default:
        hh = (r - g) / d + 4;
        break;
    }
    hh /= 6;
  }
  return { h: hh * 360, s, l };
}
var STATE_BASE_HSL = {};
for (const key in STATE_COLORS) {
  STATE_BASE_HSL[key] = hexToHsl(STATE_COLORS[key]);
}
var MAX_PARTIALS2 = PERSONA_STAGES.reduce((m, s) => Math.max(m, s.partials), -Infinity);
var Visualizer = class {
  constructor(canvas2) {
    this.canvas = canvas2;
    this.ctx = canvas2.getContext("2d");
    this.synth = null;
    this.running = false;
    this._gridOffset = 0;
    this.ctx.globalAlpha = INITIAL_GLOBAL_ALPHA;
    this.trails = [];
    this.smearAmount = 0;
    this.entropyAmount = 0;
    this.refinementAmount = INITIAL_REFINEMENT;
    this.energyAmount = ENERGY_DEFAULT;
    window.addEventListener("resize", () => this._resize());
    this._resize();
  }
  setSynth(synth2) {
    this.synth = synth2;
  }
  setSmear(amount) {
    const a = Math.min(1, Math.max(0, amount));
    this.smearAmount = a;
    if (a === 0) this.trails = [];
  }
  setEntropy(amount) {
    this.entropyAmount = Math.min(1, Math.max(0, amount));
  }
  setRefinement(amount) {
    this.refinementAmount = Math.min(1, Math.max(0, amount));
  }
  setEnergy(amount) {
    this.energyAmount = Math.min(1, Math.max(0, amount));
  }
  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._drawFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() {
    this.running = false;
  }
  _drawFrame() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const time = this.synth ? this.synth.ctx.currentTime : performance.now() / MS_TO_SECONDS;
    this._drawBackground(ctx, w, h);
    this._drawTrails(time);
    this._drawWavesStack(ctx, w, h, time);
    this._drawNoiseOverlay(ctx, w, h);
    if (this.smearAmount > 0) this._addTrailFrame(time);
  }
  _drawBackground(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, BG_TOP_COLOR);
    grad.addColorStop(BG_MID_STOP, BG_MID_COLOR);
    grad.addColorStop(1, BG_BOTTOM_COLOR);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = GRID_LINE_COLOR;
    ctx.lineWidth = GRID_LINE_WIDTH + GRID_LINE_WIDTH_ENERGY_SCALE * this.energyAmount;
    ctx.globalAlpha = GRID_ALPHA_BASE + GRID_ALPHA_ENERGY_SCALE * this.energyAmount;
    const horizonY = h * HORIZON_Y_FACTOR;
    const vanishingX = w * VANISHING_X_FACTOR;
    const numLines = GRID_NUM_LINES;
    for (let i = 0; i <= numLines; i++) {
      const x = i / numLines * w;
      ctx.beginPath();
      ctx.moveTo(vanishingX, horizonY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.restore();
  }
  _addTrailFrame(time) {
    const off = document.createElement("canvas");
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const octx = off.getContext("2d");
    octx.drawImage(this.canvas, 0, 0);
    this.trails.push({ image: off, t0: time });
    const maxFrames = TRAIL_MAX_FRAMES;
    if (this.trails.length > maxFrames) this.trails.splice(0, this.trails.length - maxFrames);
  }
  _drawTrails(time) {
    if (this.smearAmount <= 0 || this.trails.length === 0) return;
    const ctx = this.ctx;
    const gravity = TRAIL_BASE_GRAVITY + TRAIL_GRAVITY_SCALE * this.smearAmount;
    const baseVel = TRAIL_BASE_VELOCITY;
    const alive = [];
    for (const trail of this.trails) {
      const dt = time - trail.t0;
      const y = baseVel * dt + 0.5 * (gravity * TRAIL_GRAVITY_PIXEL_SCALE) * dt * dt;
      let alpha = TRAIL_BASE_ALPHA - dt * TRAIL_ALPHA_DECAY * (TRAIL_ALPHA_BIAS + this.smearAmount);
      if (alpha <= 0 || y > this.canvas.height * TRAIL_MAX_HEIGHT_MULTIPLIER) continue;
      alive.push(trail);
      ctx.save();
      for (let i = 0; i < TRAIL_ECHO_COUNT; i++) {
        const ax = Math.max(0, alpha * Math.pow(TRAIL_ECHO_ALPHA_SCALE, i));
        if (ax <= 0) continue;
        ctx.globalAlpha = ax;
        const ox = i * TRAIL_ECHO_OFFSET_X;
        const oy = y + i * TRAIL_ECHO_OFFSET_Y;
        ctx.drawImage(trail.image, ox, oy);
      }
      ctx.restore();
    }
    this.trails = alive;
  }
  _drawNoiseOverlay(ctx, w, h) {
    const e = this.entropyAmount;
    if (e <= NOISE_MIN_ENTROPY) return;
    const count = Math.floor(
      NOISE_COUNT_SCALE * e * e * (NOISE_ENERGY_BASE + NOISE_ENERGY_SCALE * this.energyAmount)
    );
    ctx.save();
    ctx.globalAlpha = NOISE_BASE_ALPHA + NOISE_ALPHA_SCALE * e;
    ctx.fillStyle = NOISE_FILL_COLOR;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const size = NOISE_MIN_SIZE + NOISE_SIZE_RANGE * Math.random();
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
  }
  _computeSquish(time) {
    const e = this.entropyAmount;
    if (e <= SQUISH_MIN_ENTROPY) return 0;
    const s1 = SQUISH_FREQ1_BASE + SQUISH_FREQ1_SCALE * e;
    const s2 = SQUISH_FREQ2_BASE + SQUISH_FREQ2_SCALE * e;
    const a = Math.sin(time * s1) + Math.sin(time * s2 + SQUISH_PHASE_OFFSET);
    return SQUISH_OUTPUT_SCALE * a * e;
  }
  _drawWavesStack(ctx, w, h, time) {
    if (!this.synth) return;
    const state = this.synth.getState();
    const dominantId = state.dominant.id || "";
    const normalizedId = dominantId.toLowerCase();
    const baseHsl = STATE_BASE_HSL[normalizedId] || STATE_BASE_HSL.rut;
    const weights = state.weights || [];
    const richnessNorm = Math.min(1, Math.max(0, state.richnessNorm || 0));
    const wavetablePos2 = typeof state.wavetablePos === "number" ? Math.min(1, Math.max(0, state.wavetablePos)) : 0;
    const minLines = MIN_LINES;
    const maxLines = MAX_LINES;
    let lineCount = Math.round(minLines + richnessNorm * (maxLines - minLines));
    const energyFactor = 0.5 + 0.8 * this.energyAmount;
    lineCount = Math.round(lineCount * energyFactor);
    if (lineCount < minLines) lineCount = minLines;
    if (lineCount > maxLines) lineCount = maxLines;
    const minCycles = MIN_CYCLES;
    const maxCycles = MAX_CYCLES;
    const baseCycles = minCycles + richnessNorm * (maxCycles - minCycles);
    const squish = this._computeSquish(time);
    const cycles = baseCycles * (1 + 0.5 * squish);
    const topY = h * TOP_Y_FACTOR;
    const stackHeight = h * STACK_HEIGHT_FACTOR;
    const baseAmp = h * BASE_AMP_FACTOR;
    const samples = SAMPLE_COUNT;
    const refinementBoost = REFINEMENT_BOOST_BASE + REFINEMENT_BOOST_SCALE * this.refinementAmount;
    const rb = this.refinementAmount;
    const s0 = baseHsl.s * SATURATION_BASE_SCALE;
    const s = Math.min(1, s0 + (baseHsl.s - s0) * (SATURATION_BLEND_BASE + SATURATION_BLEND_SCALE * rb));
    const l = Math.min(1, baseHsl.l * (LIGHTNESS_BASE_SCALE + LIGHTNESS_BLEND_SCALE * rb));
    const color = `hsl(${baseHsl.h.toFixed(1)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.shadowColor = color;
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const depth = lineCount <= 1 ? 0 : lineIndex / (lineCount - 1);
      const yCenter = topY + depth * stackHeight;
      const squishAmpFactor = 1 - SQUISH_AMP_REDUCTION * squish;
      const amp = baseAmp * (DEPTH_AMP_BASE + DEPTH_AMP_SCALE * depth) * squishAmpFactor;
      let alpha = (ALPHA_BASE + ALPHA_DEPTH_SCALE * depth) * refinementBoost;
      alpha = Math.min(1, alpha);
      const maxPartialScale = 0.3 + 2.7 * depth;
      const maxPartial = 1 + Math.round(maxPartialScale * (MAX_PARTIALS2 - 1));
      ctx.beginPath();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = (SHADOW_BLUR_BASE + SHADOW_BLUR_SCALE * depth) * refinementBoost;
      for (let i = 0; i <= samples; i++) {
        const tNorm = i / samples;
        const x = tNorm * w;
        const theta = tNorm * TWO_PI2 * cycles + time * CYCLES_TIME_SCALE + depth * CYCLES_DEPTH_OFFSET;
        const sample = this._sampleWave(theta, time + depth * SQUISH_DEPTH_TIME_SCALE, weights, maxPartial, wavetablePos2);
        const y = yCenter + amp * sample;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  _sampleWave(theta, time, weights, maxPartial, wavetablePos2) {
    const entropy = this.entropyAmount;
    let sample = 0;
    let pos = Math.min(1, Math.max(0, wavetablePos2 || 0));
    let p = Math.pow(pos, WAVETABLE_CURVE);
    let personaSample = 0;
    p = POS_CENTER + (p - POS_CENTER) * WAVETABLE_INTENSITY;
    p = Math.min(1, Math.max(0, p));
    for (let i = 0; i < PERSONA_STAGES.length; i++) {
      const weight = weights[i] || 0;
      if (weight <= 0) continue;
      const stagePartials = PERSONA_STAGES[i].partials;
      const effectivePartials = Math.min(stagePartials, maxPartial);
      for (let n = 1; n <= effectivePartials; n++) {
        const sineAmp = n === 1 ? 1 : 0;
        const triAmp = n % 2 === 1 ? (n % 4 === 1 ? 1 : -1) / (n * n) : 0;
        const sawAmp = 1 / n;
        const brightBoost = 1 + BRIGHT_BOOST_SCALE * (n / effectivePartials);
        const brightAmp = 1 / n * brightBoost;
        let amp;
        if (p < 1 / 3) {
          const t = p / (1 / 3);
          amp = sineAmp * (1 - t) + triAmp * t;
        } else if (p < 2 / 3) {
          const t = (p - 1 / 3) / (1 / 3);
          amp = triAmp * (1 - t) + sawAmp * t;
        } else {
          const t = (p - 2 / 3) / (1 / 3);
          amp = sawAmp * (1 - t) + brightAmp * t;
        }
        const jitterPhase = (Math.random() - 0.5) * entropy * JITTER_PHASE_SCALE;
        const phase = theta * n + time * n * TIME_FREQ_SCALE + jitterPhase;
        personaSample += Math.sin(phase) * amp;
      }
      sample += weight * personaSample;
    }
    return Math.tanh(sample);
  }
};

// demo/main.mjs
var canvas = document.getElementById("scene");
var startButton = document.getElementById("start");
var slider = document.getElementById("persona");
var stageLabel = document.getElementById("stageLabel");
var delayControl = document.getElementById("delayControl");
var entropyControl = document.getElementById("entropyControl");
var refinementControl = document.getElementById("refinementControl");
var personaLfoDepth = document.getElementById("personaLfoDepth");
var delayLfoDepth = document.getElementById("delayLfoDepth");
var entropyLfoDepth = document.getElementById("entropyLfoDepth");
var refinementLfoDepth = document.getElementById("refinementLfoDepth");
var rootNoteInput = document.getElementById("rootNote");
var noteUpButton = document.getElementById("noteUp");
var noteDownButton = document.getElementById("noteDown");
var wavetablePos = document.getElementById("wavetablePos");
var TRANSPOSE_SEMITONES = -7;
var NOTE_OFFSETS = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };
var TWO_PI3 = Math.PI * 2;
var A4_HZ = 440;
var A4_MIDI = 69;
var SEMITONES_PER_OCTAVE2 = 12;
var MIN_MIDI_NOTE = 12;
var MAX_MIDI_NOTE = 108;
var DEFAULT_ROOT_OCTAVE = 3;
var DEFAULT_ROOT_MIDI = 60;
var FALLBACK_STEP_ROOT_MIDI = 57;
var MIN_ROOT_MIDI = 24;
var MAX_ROOT_MIDI = 96;
var MS_TO_SECONDS2 = 1e3;
var DEFAULT_REFINEMENT_BASE = 0.5;
var MIDI_STATUS_MASK = 240;
var MIDI_NOTE_ON = 144;
var LFO_JUMP_PROB_PER_SEC = 0.15;
var LFO_AMPLITUDE_SCALE = 0.5;
var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var NOTE_REGEX = /^([a-g])([#b]?)(\d+)?$/;
var DEFAULT_PERSONA_LFO_DEPTH = 0.25;
var DEFAULT_PERSONA_LFO_FREQ = 0.03;
var DEFAULT_PERSONA_LFO_MIN_FREQ = 5e-3;
var DEFAULT_PERSONA_LFO_MAX_FREQ = 0.2;
var DEFAULT_PERSONA_LFO_JITTER = 0.8;
var DEFAULT_DELAY_LFO_DEPTH = 0.2;
var DEFAULT_DELAY_LFO_FREQ = 0.04;
var DEFAULT_DELAY_LFO_MIN_FREQ = 8e-3;
var DEFAULT_DELAY_LFO_MAX_FREQ = 0.25;
var DEFAULT_DELAY_LFO_JITTER = 1;
var DEFAULT_ENTROPY_LFO_DEPTH = 0.15;
var DEFAULT_ENTROPY_LFO_FREQ = 0.05;
var DEFAULT_ENTROPY_LFO_MIN_FREQ = 0.01;
var DEFAULT_ENTROPY_LFO_MAX_FREQ = 0.3;
var DEFAULT_ENTROPY_LFO_JITTER = 1.2;
var DEFAULT_REFINEMENT_LFO_DEPTH = 0.15;
var DEFAULT_REFINEMENT_LFO_FREQ = 0.02;
var DEFAULT_REFINEMENT_LFO_MIN_FREQ = 4e-3;
var DEFAULT_REFINEMENT_LFO_MAX_FREQ = 0.16;
var DEFAULT_REFINEMENT_LFO_JITTER = 0.7;
var lfoState = {
  persona: {
    base: Number(slider.value) || 0,
    depth: personaLfoDepth ? Number(personaLfoDepth.value) || 0 : DEFAULT_PERSONA_LFO_DEPTH,
    phase: Math.random() * TWO_PI3,
    freq: DEFAULT_PERSONA_LFO_FREQ,
    minFreq: DEFAULT_PERSONA_LFO_MIN_FREQ,
    maxFreq: DEFAULT_PERSONA_LFO_MAX_FREQ,
    jitter: DEFAULT_PERSONA_LFO_JITTER
  },
  delay: {
    base: Number(delayControl.value) || 0,
    depth: delayLfoDepth ? Number(delayLfoDepth.value) || 0 : DEFAULT_DELAY_LFO_DEPTH,
    phase: Math.random() * TWO_PI3,
    freq: DEFAULT_DELAY_LFO_FREQ,
    minFreq: DEFAULT_DELAY_LFO_MIN_FREQ,
    maxFreq: DEFAULT_DELAY_LFO_MAX_FREQ,
    jitter: DEFAULT_DELAY_LFO_JITTER
  },
  entropy: {
    base: Number(entropyControl.value) || 0,
    depth: entropyLfoDepth ? Number(entropyLfoDepth.value) || 0 : DEFAULT_ENTROPY_LFO_DEPTH,
    phase: Math.random() * TWO_PI3,
    freq: DEFAULT_ENTROPY_LFO_FREQ,
    minFreq: DEFAULT_ENTROPY_LFO_MIN_FREQ,
    maxFreq: DEFAULT_ENTROPY_LFO_MAX_FREQ,
    jitter: DEFAULT_ENTROPY_LFO_JITTER
  },
  refinement: {
    base: Number(refinementControl.value) || DEFAULT_REFINEMENT_BASE,
    depth: refinementLfoDepth ? Number(refinementLfoDepth.value) || 0 : DEFAULT_REFINEMENT_LFO_DEPTH,
    phase: Math.random() * TWO_PI3,
    freq: DEFAULT_REFINEMENT_LFO_FREQ,
    minFreq: DEFAULT_REFINEMENT_LFO_MIN_FREQ,
    maxFreq: DEFAULT_REFINEMENT_LFO_MAX_FREQ,
    jitter: DEFAULT_REFINEMENT_LFO_JITTER
  }
};
var visualizer = new Visualizer(canvas);
visualizer.start();
var synth = null;
var currentRootMidi = null;
var midiAccess = null;
var lastTime = performance.now() / MS_TO_SECONDS2;
function applyWavetable(value) {
  const v = clamp01(value);
  if (wavetablePos) wavetablePos.value = v;
  if (synth && typeof synth.setWavetablePos === "function") synth.setWavetablePos(v);
}
if (wavetablePos) {
  wavetablePos.addEventListener("input", () => {
    const v = Number(wavetablePos.value);
    if (!Number.isFinite(v)) return;
    applyWavetable(v);
    updateHashFromUI();
  });
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function midiToHz(midi) {
  return A4_HZ * Math.pow(2, (midi + TRANSPOSE_SEMITONES - A4_MIDI) / SEMITONES_PER_OCTAVE2);
}
function midiToNoteName(midi) {
  const clamped = Math.max(MIN_MIDI_NOTE, Math.min(MAX_MIDI_NOTE, midi));
  const octave = Math.floor(clamped / SEMITONES_PER_OCTAVE2) - 1;
  const semitone = clamped % SEMITONES_PER_OCTAVE2;
  const NAMES = NOTE_NAMES;
  return `${NAMES[semitone]}${octave}`;
}
function parseNoteToMidi(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase(), m = NOTE_REGEX.exec(s);
  if (!m) return null;
  let [, letter, acc, octStr] = m;
  let key = letter;
  if (acc === "#" || acc === "b") key += acc;
  const semi = NOTE_OFFSETS[key];
  if (semi == null) return null;
  const octave = octStr != null ? parseInt(octStr, 10) : DEFAULT_ROOT_OCTAVE;
  if (!Number.isFinite(octave)) return null;
  const midi = (octave + 1) * SEMITONES_PER_OCTAVE2 + semi;
  return midi;
}
function initSynthIfNeeded() {
  if (synth) return;
  synth = new PersonaWavetableSynth();
  visualizer.setSynth(synth);
  if (rootNoteInput) {
    let midi = parseNoteToMidi(rootNoteInput.value);
    if (midi == null) midi = DEFAULT_ROOT_MIDI;
    currentRootMidi = midi;
    const hz = midiToHz(midi);
    if (typeof synth.setRootHz === "function") synth.setRootHz(hz);
    rootNoteInput.value = midiToNoteName(midi);
  }
  const delayVal = Number(delayControl.value) || 0, entropyVal = Number(entropyControl.value) || 0;
  const refineVal = Number(refinementControl.value) || DEFAULT_REFINEMENT_BASE;
  synth.setDelay(delayVal);
  synth.setEntropy(entropyVal);
  synth.setRefinement(refineVal);
  visualizer.setSmear(delayVal);
  visualizer.setEntropy(entropyVal);
  visualizer.setRefinement(refineVal);
}
function updateLabels() {
  if (!stageLabel) return;
  if (!synth) {
    const tRaw = Number(slider && slider.value), t = clamp01(Number.isFinite(tRaw) ? tRaw : 0);
    let closest = PERSONA_STAGES[0], bestDist = Infinity;
    for (const s of PERSONA_STAGES) {
      const d = Math.abs(t - s.position);
      if (d < bestDist) {
        bestDist = d;
        closest = s;
      }
    }
    stageLabel.textContent = `${closest.id}`;
    return;
  }
  const state = synth.getState(), dominant = state.dominant;
  const id = dominant && dominant.id ? dominant.id : "Rut";
  stageLabel.textContent = `${id}`;
}
function updatePlayButtonLabel() {
  if (!synth) {
    startButton.textContent = "Play";
    togglePlay();
  } else if (synth.ctx.state === "suspended") {
    startButton.textContent = "Play";
  } else if (synth.ctx.state === "running") {
    startButton.textContent = "Pause";
  }
}
async function togglePlay() {
  initSynthIfNeeded();
  if (!synth) return;
  if (synth.ctx.state === "running") {
    await synth.pause();
  } else if (synth.ctx.state === "suspended") {
    await synth.resume();
  } else {
    togglePlay();
  }
  updatePlayButtonLabel();
  updateLabels();
}
function applyPersona(value) {
  const v = clamp01(value);
  slider.value = v;
  if (synth) {
    synth.setValue(v);
    updateLabels();
  }
}
function applyDelay(value) {
  const v = clamp01(value);
  delayControl.value = v;
  visualizer.setSmear(v);
  if (synth) synth.setDelay(v);
}
function applyEntropy(value) {
  const v = clamp01(value);
  entropyControl.value = v;
  visualizer.setEntropy(v);
  if (synth) synth.setEntropy(v);
}
function applyRefinement(value) {
  const v = clamp01(value);
  refinementControl.value = v;
  visualizer.setRefinement(v);
  if (synth) synth.setRefinement(v);
}
function setRootFromMidi(midi) {
  if (midi == null) return;
  const minMidi = MIN_ROOT_MIDI, maxMidi = MAX_ROOT_MIDI;
  const clamped = Math.max(minMidi, Math.min(maxMidi, midi));
  currentRootMidi = clamped;
  if (rootNoteInput) rootNoteInput.textContent = midiToNoteName(clamped);
  initSynthIfNeeded();
  if (synth && typeof synth.setRootHz === "function") synth.setRootHz(midiToHz(clamped));
}
function setRootFromInput() {
  if (!rootNoteInput) return;
  let midi = parseNoteToMidi(rootNoteInput.value);
  if (midi == null) return;
  setRootFromMidi(midi);
}
function stepRoot(deltaSemitones) {
  if (currentRootMidi == null) {
    let midi = parseNoteToMidi(rootNoteInput && rootNoteInput.value);
    if (midi == null) midi = FALLBACK_STEP_ROOT_MIDI;
    currentRootMidi = midi;
  }
  setRootFromMidi(currentRootMidi + deltaSemitones);
}
function initMIDI() {
  if (!("requestMIDIAccess" in navigator)) return;
  navigator.requestMIDIAccess().then(
    (access) => {
      midiAccess = access;
      attachMIDIInputs(access);
      access.onstatechange = () => attachMIDIInputs(access);
    },
    () => {
    }
  );
}
function attachMIDIInputs(access) {
  if (!access || !access.inputs) return;
  for (const input of access.inputs.values()) {
    input.onmidimessage = handleMIDIMessage;
  }
}
function handleMIDIMessage(event) {
  const data = event.data;
  if (!data || data.length < 2) return;
  const status = data[0] & MIDI_STATUS_MASK, note = data[1], velocity = data[2] || 0;
  if (status === MIDI_NOTE_ON && velocity > 0) {
    setRootFromMidi(note);
    updateHashFromUI();
  }
}
if (personaLfoDepth) personaLfoDepth.addEventListener("input", () => {
  lfoState.persona.depth = Number(personaLfoDepth.value) || 0;
  updateHashFromUI();
});
if (delayLfoDepth) delayLfoDepth.addEventListener("input", () => {
  lfoState.delay.depth = Number(delayLfoDepth.value) || 0;
  updateHashFromUI();
});
if (entropyLfoDepth) entropyLfoDepth.addEventListener("input", () => {
  lfoState.entropy.depth = Number(entropyLfoDepth.value) || 0;
  updateHashFromUI();
});
if (refinementLfoDepth) refinementLfoDepth.addEventListener("input", () => {
  lfoState.refinement.depth = Number(refinementLfoDepth.value) || 0;
  updateHashFromUI();
});
function updateLfoParam(name, applyFn, dt) {
  const s = lfoState[name];
  if (!s || s.depth <= 0) return;
  const drift = (Math.random() - 0.5) * s.jitter * dt;
  let newFreq = s.freq + drift;
  if (newFreq < s.minFreq) newFreq = s.minFreq;
  if (newFreq > s.maxFreq) newFreq = s.maxFreq;
  if (Math.random() < LFO_JUMP_PROB_PER_SEC * dt) newFreq = s.minFreq + Math.random() * (s.maxFreq - s.minFreq);
  s.freq = newFreq;
  s.phase += TWO_PI3 * s.freq * dt;
  const sinus = Math.sin(s.phase), amplitude = s.depth * LFO_AMPLITUDE_SCALE, value = s.base + sinus * amplitude;
  applyFn(value);
}
function stepLfo() {
  const now = performance.now() / MS_TO_SECONDS2, dt = now - lastTime;
  lastTime = now;
  if (dt > 0) {
    updateLfoParam("persona", applyPersona, dt);
    updateLfoParam("delay", applyDelay, dt);
    updateLfoParam("entropy", applyEntropy, dt);
    updateLfoParam("refinement", applyRefinement, dt);
  }
  requestAnimationFrame(stepLfo);
}
function getConfigFromUI() {
  const cfg = {};
  if (slider) cfg.p = Number(slider.value) || 0;
  if (delayControl) cfg.d = Number(delayControl.value) || 0;
  if (entropyControl) cfg.e = Number(entropyControl.value) || 0;
  if (refinementControl) cfg.r = Number(refinementControl.value) || 0;
  if (personaLfoDepth) cfg.pl = Number(personaLfoDepth.value) || 0;
  if (delayLfoDepth) cfg.dl = Number(delayLfoDepth.value) || 0;
  if (entropyLfoDepth) cfg.el = Number(entropyLfoDepth.value) || 0;
  if (refinementLfoDepth) cfg.rl = Number(refinementLfoDepth.value) || 0;
  if (wavetablePos) cfg.w = Number(wavetablePos.value) || 0;
  if (rootNoteInput) {
    const txt = rootNoteInput.textContent || rootNoteInput.value || "";
    if (txt && typeof txt === "string") cfg.rn = txt.trim();
  }
  return cfg;
}
function encodeConfig(cfg) {
  const parts = [];
  function pushNum(key, v) {
    if (v == null || !Number.isFinite(v)) return;
    parts.push(key + "=" + v.toFixed(3));
  }
  pushNum("p", cfg.p);
  pushNum("d", cfg.d);
  pushNum("e", cfg.e);
  pushNum("r", cfg.r);
  pushNum("pl", cfg.pl);
  pushNum("dl", cfg.dl);
  pushNum("el", cfg.el);
  pushNum("rl", cfg.rl);
  pushNum("w", cfg.w);
  if (cfg.rn) parts.push("rn=" + encodeURIComponent(cfg.rn));
  return parts.join("&");
}
function decodeConfig(str) {
  const out = {};
  if (!str) return out;
  const s = str.charAt(0) === "#" ? str.slice(1) : str;
  if (!s) return out;
  const pairs = s.split("&");
  for (const pair of pairs) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    if (key === "rn") {
      out.rn = decodeURIComponent(raw);
    } else {
      const v = parseFloat(raw);
      if (Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}
function applyConfigToUI(cfg) {
  if (!cfg) return;
  if (cfg.p != null && slider) {
    const v = Number(cfg.p);
    if (Number.isFinite(v)) {
      if (lfoState.persona) lfoState.persona.base = v;
      applyPersona(v);
    }
  }
  if (cfg.d != null && delayControl) {
    const v = Number(cfg.d);
    if (Number.isFinite(v)) {
      if (lfoState.delay) lfoState.delay.base = v;
      applyDelay(v);
    }
  }
  if (cfg.e != null && entropyControl) {
    const v = Number(cfg.e);
    if (Number.isFinite(v)) {
      if (lfoState.entropy) lfoState.entropy.base = v;
      applyEntropy(v);
    }
  }
  if (cfg.r != null && refinementControl) {
    const v = Number(cfg.r);
    if (Number.isFinite(v)) {
      if (lfoState.refinement) lfoState.refinement.base = v;
      applyRefinement(v);
    }
  }
  if (cfg.pl != null && personaLfoDepth) {
    const v = Number(cfg.pl);
    if (Number.isFinite(v)) {
      personaLfoDepth.value = v;
      if (lfoState.persona) lfoState.persona.depth = v;
    }
  }
  if (cfg.dl != null && delayLfoDepth) {
    const v = Number(cfg.dl);
    if (Number.isFinite(v)) {
      delayLfoDepth.value = v;
      if (lfoState.delay) lfoState.delay.depth = v;
    }
  }
  if (cfg.el != null && entropyLfoDepth) {
    const v = Number(cfg.el);
    if (Number.isFinite(v)) {
      entropyLfoDepth.value = v;
      if (lfoState.entropy) lfoState.entropy.depth = v;
    }
  }
  if (cfg.rl != null && refinementLfoDepth) {
    const v = Number(cfg.rl);
    if (Number.isFinite(v)) {
      refinementLfoDepth.value = v;
      if (lfoState.refinement) lfoState.refinement.depth = v;
    }
  }
  if (cfg.w != null && wavetablePos) {
    const v = Number(cfg.w);
    if (Number.isFinite(v)) applyWavetable(v);
  }
  if (cfg.rn) {
    const midi = parseNoteToMidi(cfg.rn);
    if (midi != null) {
      setRootFromMidi(midi);
    }
  }
  updateLabels();
}
function updateHashFromUI() {
  const cfg = getConfigFromUI();
  const hash = encodeConfig(cfg);
  if (!hash) return;
  if ("#" + hash === window.location.hash) return;
  window.location.hash = hash;
}
function loadConfigFromHash() {
  const raw = window.location.hash;
  if (!raw || raw.length <= 1) return;
  const cfg = decodeConfig(raw);
  applyConfigToUI(cfg);
}
startButton.addEventListener("click", () => {
  togglePlay();
});
slider.addEventListener("input", () => {
  const t = Number(slider.value);
  if (!Number.isFinite(t)) return;
  if (lfoState.persona) lfoState.persona.base = t;
  applyPersona(t);
  updateHashFromUI();
});
delayControl.addEventListener("input", () => {
  const v = Number(delayControl.value);
  if (!Number.isFinite(v)) return;
  if (lfoState.delay) lfoState.delay.base = v;
  applyDelay(v);
  updateHashFromUI();
});
entropyControl.addEventListener("input", () => {
  const v = Number(entropyControl.value);
  if (!Number.isFinite(v)) return;
  if (lfoState.entropy) lfoState.entropy.base = v;
  applyEntropy(v);
  updateHashFromUI();
});
refinementControl.addEventListener("input", () => {
  const v = Number(refinementControl.value);
  if (!Number.isFinite(v)) return;
  if (lfoState.refinement) lfoState.refinement.base = v;
  applyRefinement(v);
  updateHashFromUI();
});
if (rootNoteInput) {
  rootNoteInput.addEventListener("change", () => {
    setRootFromInput();
    updateHashFromUI();
  });
  rootNoteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      setRootFromInput();
      updateHashFromUI();
    }
  });
}
if (noteUpButton) noteUpButton.addEventListener("click", () => {
  stepRoot(1);
  updateHashFromUI();
});
if (noteDownButton) noteDownButton.addEventListener("click", () => {
  stepRoot(-1);
  updateHashFromUI();
});
updatePlayButtonLabel();
loadConfigFromHash();
updateLabels();
stepLfo();
initMIDI();
window.addEventListener("hashchange", () => {
  loadConfigFromHash();
});
//# sourceMappingURL=bundle.mjs.map
