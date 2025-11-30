export const PERSONA_STAGES = [
  { id: 'Rut', position: 0.0, partials: 2  },
  { id: 'Emerging', position: 1 / 3, partials: 4  },
  { id: 'Growing', position: 2 / 3, partials: 8  },
  { id: 'Taste', position: 1.0, partials: 16 }
]
export const WAVETABLE_INTENSITY = 2.6
export const WAVETABLE_CURVE = 1.2
const PERSONA_CHORDS = { Rut: [0, 1],  Emerging: [0, 1, 7], Growing:  [0, 2, 7], Taste: [0, 1, 4, 7] }
const MIN_FUNDAMENTAL = 50
const MAX_FUNDAMENTAL = 440
const MIN_PARTIALS = PERSONA_STAGES.reduce((m, s) => Math.min(m, s.partials), Infinity)
const MAX_PARTIALS = PERSONA_STAGES.reduce((m, s) => Math.max(m, s.partials), -Infinity)
const MASTER_GAIN_DEFAULT = 0.25
const PREDRIVE_GAIN_DEFAULT = 1.0
const DISTORTION_DEFAULT_AMOUNT = 40
const DISTORTION_FALLBACK_K = 10
const DISTORTION_SAMPLE_COUNT = 44100
const DISTORTION_INPUT_SCALE = 2.5
const DISTORTION_BASE_OFFSET = 5
const DISTORTION_GAIN_MULTIPLIER = 30
const DEG_TO_RAD = Math.PI / 180
const WAVETABLE_INITIAL_POS = 0.0
const TWO_PI = Math.PI * 2
const DELAY_MAX_TIME = 3.0
const DELAY_RANDOM_BASE = 0.08
const FEEDBACK_INITIAL_GAIN = 0
const REFINEMENT_INITIAL = 0.5
const COUPLING_INITIAL = 0
const STATE_LAG_DEFAULT = 0.01
const TURBULENCE_MIN_ENTROPY = 0.01
const TURBULENCE_BASE_FREQ1 = 0.4
const TURBULENCE_SCALE_FREQ1 = 0.8
const TURBULENCE_BASE_FREQ2 = 0.2
const TURBULENCE_SCALE_FREQ2 = 0.6
const TURBULENCE_PHASE_OFFSET2 = 1.3
const TURBULENCE_OUTPUT_SCALE = 0.5
const ROOT_MIN_HZ = 20
const ROOT_MAX_HZ = 2000
const RICHNESS_BASE_FACTOR = 0.8
const RICHNESS_SCALE_FACTOR = 0.4
const DETUNE_SPREAD = 0.05
const ENTROPY_JITTER_SCALE = 4
const FREQ_LAG_TIME = 0.05
const REFINEMENT_MIN_CUTOFF = 400
const REFINEMENT_MAX_CUTOFF = 8000
const REFINEMENT_MIN_Q = 0.7
const REFINEMENT_MAX_Q = 8
const REFINEMENT_CUTOFF_MIN = 200
const REFINEMENT_CUTOFF_MAX = 12000
const FILTER_TIME_CONST = 0.1
const FILTER_Q_TIME_CONST = 0.1
const ENTROPY_TURB_THRESHOLD = 0.01
const TURBULENCE_MOD_SCALE = 0.35
const TURBULENCE_Q_SCALE = 0.2
const DELAY_MIN_TIME = 0.02
const DELAY_TIME_SCALE = 1.5
const FEEDBACK_MIN = 0.0
const FEEDBACK_MAX = 0.35
const DELAY_TIME_CONST = 0.1
const FEEDBACK_TIME_CONST = 0.2
const DRIVE_MIN = 1.0
const DRIVE_MAX = 24.0
const DRIVE_TIME_CONST = 0.05
const LAG_BASE = 0.01
const LAG_SCALE = 0.3
const SEMITONES_PER_OCTAVE = 12

export class PersonaWavetableSynth {
  constructor(audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext
    this.ctx = audioContext || new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = MASTER_GAIN_DEFAULT
    this.preDrive = this.ctx.createGain()
    this.preDrive.gain.value = PREDRIVE_GAIN_DEFAULT
    this.waveShaper = this.ctx.createWaveShaper()
    this.waveShaper.curve = this._makeDistortionCurve(DISTORTION_DEFAULT_AMOUNT)
    this.waveShaper.oversample = '4x'
    this.wavetablePos = WAVETABLE_INITIAL_POS
    this.filter = this.ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.delay = this.ctx.createDelay(DELAY_MAX_TIME)
    this.feedback = this.ctx.createGain()
    this.master.connect(this.preDrive)
    this.preDrive.connect(this.waveShaper)
    this.waveShaper.connect(this.filter)
    this.filter.connect(this.ctx.destination)
    this.filter.connect(this.delay)
    this.delay.connect(this.feedback)
    this.feedback.connect(this.delay)
    this.delay.connect(this.ctx.destination)
    this.delay.delayTime.value = Math.random() * DELAY_RANDOM_BASE
    this.feedback.gain.value = FEEDBACK_INITIAL_GAIN
    this.personas = []
    this._weights = new Array(PERSONA_STAGES.length).fill(0)
    this.value = 0
    this._richnessNorm = 0
    this.baseNoteHz = (MIN_FUNDAMENTAL + MAX_FUNDAMENTAL) * 0.5
    this._fundamental = this.baseNoteHz
    this.entropyAmount = 0
    this.refinementAmount = REFINEMENT_INITIAL
    this.coupling = COUPLING_INITIAL
    this.stateLag = STATE_LAG_DEFAULT
    this._turbPhase1 = Math.random() * TWO_PI
    this._turbPhase2 = Math.random() * TWO_PI
    PERSONA_STAGES.forEach(stage => {
      const personaGain = this.ctx.createGain()
      personaGain.gain.value = 0
      personaGain.connect(this.master)
      const voices = []
      const semis = PERSONA_CHORDS[stage.id] || [0]
      const count = semis.length || 1
      semis.forEach(semi => {
        const ratio = Math.pow(2, semi / SEMITONES_PER_OCTAVE)
        const osc = this.ctx.createOscillator()
        const wave = this._buildWave(stage.partials)
        osc.setPeriodicWave(wave)
        osc.frequency.value = this._fundamental * ratio
        const voiceGain = this.ctx.createGain()
        voiceGain.gain.value = 1 / count
        osc.connect(voiceGain).connect(personaGain)
        osc.start()
        voices.push({ osc, ratio, gain: voiceGain })
      })
      this.personas.push({ stage, gain: personaGain, voices })
    })
    this.setValue(0)
    this._applyRefinement()
  }

  setWavetablePos(amount) {
    const a = Math.min(1, Math.max(0, amount))
    this.wavetablePos = a
    this._updateWaves()
  }

  _updateWaves() {
    const pos = this.wavetablePos
    this.personas.forEach(p => {
      const wave = this._buildWave(p.stage.partials, pos)
      p.voices.forEach(v => { v.osc.setPeriodicWave(wave) })
    })
  }
  
  _buildWave(partials, pos = this.wavetablePos || 0) {
    pos = Math.min(1, Math.max(0, pos))
    let p = Math.pow(pos, WAVETABLE_CURVE)
    p = 0.1 + (p - 0.5) * WAVETABLE_INTENSITY
    p = Math.min(1, Math.max(0, p))
    const real = new Float32Array(partials + 1)
    const imag = new Float32Array(partials + 1)
    real[0] = 0
    for (let n = 1; n <= partials; n++) {
      const sineAmp = (n === 1) ? 1 : 0
      const triAmp = (n % 2 === 1) ? ((n % 4 === 1 ? 1 : -1) / (n * n)) : 0
      const sawAmp = 1 / n
      const brightBoost = 1 + 3 * (n / partials)
      const brightAmp = (1 / n) * brightBoost
      let a1
      if (p < 1 / 3) {
        const t = p / (1 / 3)
        a1 = sineAmp * (1 - t) + triAmp * t
      } else if (p < 2 / 3) {
        const t = (p - 1 / 3) / (1 / 3)
        a1 = triAmp * (1 - t) + sawAmp * t
      } else {
        const t = (p - 2 / 3) / (1 / 3)
        a1 = sawAmp * (1 - t) + brightAmp * t
      }
      real[n] = 0
      imag[n] = a1
    }
    return this.ctx.createPeriodicWave(real, imag)
  }

  _makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : DISTORTION_FALLBACK_K
    const n = DISTORTION_SAMPLE_COUNT
    const curve = new Float32Array(n)
    const deg = DEG_TO_RAD
    for (let i = 0; i < n; i++) {
      const x = (i * DISTORTION_INPUT_SCALE) / n - 1
      curve[i] = ((DISTORTION_BASE_OFFSET + k) * x * DISTORTION_GAIN_MULTIPLIER * deg) / (Math.PI + k * Math.abs(x))
    }
    return curve
  }

  _getTurbulenceShape() {
    const e = this.entropyAmount
    if (e <= TURBULENCE_MIN_ENTROPY) return 0
    const t = this.ctx.currentTime
    const s1 = TURBULENCE_BASE_FREQ1 + TURBULENCE_SCALE_FREQ1 * e
    const s2 = TURBULENCE_BASE_FREQ2 + TURBULENCE_SCALE_FREQ2 * e
    const a = Math.sin(t * s1 + this._turbPhase1) + Math.sin(t * s2 + this._turbPhase2 + TURBULENCE_PHASE_OFFSET2)
    return TURBULENCE_OUTPUT_SCALE * a
  }

  setRootHz(hz) {
    const h = Number(hz)
    if (!isFinite(h)) return
    const clamped = Math.max(ROOT_MIN_HZ, Math.min(ROOT_MAX_HZ, h))
    this.baseNoteHz = clamped
    this._updateSpectralParameters()
  }

  async resume() { if (this.ctx.state === 'suspended') await this.ctx.resume() }

  async pause() { if (this.ctx.state === 'running') await this.ctx.suspend() }

  setValue(t) {
    const clamped = Math.min(1, Math.max(0, t))
    this.value = clamped
    this._updateMix(clamped)
  }

  _updateMix(t) {
    const stages = this.personas
    const width = 1 / (stages.length - 1)
    let weights = stages.map(p => {
      const center = p.stage.position
      const distance = Math.abs(t - center)
      return Math.max(1 - distance / width, 0)
    })
    const sum = weights.reduce((a, b) => a + b, 0) || 1
    weights = weights.map(w => w / sum)
    if (this.coupling > 0) {
      const coupled = new Array(weights.length).fill(0)
      for (let i = 0; i < weights.length; i++) {
        let self = weights[i]
        let neighbors = 0
        let count = 0
        if (i > 0) {
          neighbors += weights[i - 1]
          count++
        }
        if (i < weights.length - 1) {
          neighbors += weights[i + 1]
          count++
        }
        const neighborAvg = count ? neighbors / count : self
        coupled[i] = (1 - this.coupling) * self + this.coupling * neighborAvg
      }
      weights = coupled
    }
    this._weights = weights
    const now = this.ctx.currentTime
    this.personas.forEach((p, i) => {
      const target = this._weights[i]
      p.gain.gain.setTargetAtTime(target, now, this.stateLag)
    })
    this._updateSpectralParameters()
  }

  _updateSpectralParameters() {
    let partialWeighted = 0
    for (let i = 0; i < PERSONA_STAGES.length; i++) { partialWeighted += (this._weights[i] || 0) * PERSONA_STAGES[i].partials }
    if (!isFinite(partialWeighted)) partialWeighted = MIN_PARTIALS
    const denom = Math.max(1, MAX_PARTIALS - MIN_PARTIALS)
    const richnessNorm = (partialWeighted - MIN_PARTIALS) / denom
    const base = this.baseNoteHz || (MIN_FUNDAMENTAL + MAX_FUNDAMENTAL) * 0.5
    const factor = RICHNESS_BASE_FACTOR + RICHNESS_SCALE_FACTOR * richnessNorm
    const fundamental = base * factor
    this._richnessNorm = richnessNorm
    this._fundamental = fundamental
    const now = this.ctx.currentTime
    const detuneSpread = DETUNE_SPREAD
    this.personas.forEach((p, i) => {
      const centerIndex = (PERSONA_STAGES.length - 1) / 2
      const offset = i - centerIndex
      const personaRatio = 1 + detuneSpread * offset
      const baseJitter = (Math.random() - 0.5) * this.entropyAmount * ENTROPY_JITTER_SCALE
      p.voices.forEach(v => {
        const localJitter = baseJitter + (Math.random() - 0.5) * this.entropyAmount
        const f = fundamental * personaRatio * v.ratio + localJitter
        v.osc.frequency.setTargetAtTime(f, now, FREQ_LAG_TIME)
      })
    })
    this._applyRefinement()
  }

  _applyRefinement() {
    const now = this.ctx.currentTime
    const a = this.refinementAmount
    const minCutoff = REFINEMENT_MIN_CUTOFF
    const maxCutoff = REFINEMENT_MAX_CUTOFF
    let cutoff = minCutoff + (maxCutoff - minCutoff) * a
    const minQ = REFINEMENT_MIN_Q
    let maxQ = REFINEMENT_MAX_Q
    const shape = this._getTurbulenceShape()
    if (this.entropyAmount > ENTROPY_TURB_THRESHOLD) {
      const e = this.entropyAmount
      const mod = 1 + TURBULENCE_MOD_SCALE * shape * e
      cutoff *= mod
      maxQ *= 1 + TURBULENCE_Q_SCALE * shape * e
    }
    cutoff = Math.max(REFINEMENT_CUTOFF_MIN, Math.min(REFINEMENT_CUTOFF_MAX, cutoff))
    this.filter.frequency.setTargetAtTime(cutoff, now, FILTER_TIME_CONST)
    this.filter.Q.setTargetAtTime(minQ + (maxQ - minQ) * a, now, FILTER_Q_TIME_CONST)
  }

  setDelay(amount) {
    const a = Math.min(1, Math.max(0, amount))
    const now = this.ctx.currentTime
    const delayTime = DELAY_MIN_TIME + DELAY_TIME_SCALE * a
    const shaped = a * a
    const fbMin = FEEDBACK_MIN
    const fbMax = FEEDBACK_MAX
    const feedbackGain = fbMin + (fbMax - fbMin) * shaped
    this.delay.delayTime.setTargetAtTime(delayTime, now, DELAY_TIME_CONST)
    this.feedback.gain.setTargetAtTime(feedbackGain, now, FEEDBACK_TIME_CONST)
  }

  setEntropy(amount) {
    const a = Math.min(1, Math.max(0, amount))
    this.entropyAmount = a
    this._updateSpectralParameters()
    const now = this.ctx.currentTime
    const minDrive = DRIVE_MIN
    const maxDrive = DRIVE_MAX
    const drive = minDrive + (maxDrive - minDrive) * a
    this.preDrive.gain.setTargetAtTime(drive, now, DRIVE_TIME_CONST)
  }

  setRefinement(amount) {
    this.refinementAmount = Math.min(1, Math.max(0, amount))
    this._applyRefinement()
  }

  setLag(amount) { this.stateLag = LAG_BASE + LAG_SCALE * Math.min(1, Math.max(0, amount)) }

  setCoupling(amount) {
    this.coupling = Math.min(1, Math.max(0, amount))
    this._updateMix(this.value)
  }

  getState() {
    const weights = this._weights.slice()
    let maxIdx = 0
    for (let i = 1; i < weights.length; i++) { if (weights[i] > weights[maxIdx]) maxIdx = i }
    return {
      value: this.value,
      weights,
      dominant: this.personas[maxIdx].stage,
      richnessNorm: this._richnessNorm,
      fundamental: this._fundamental,
      wavetablePos: this.wavetablePos
    }
  }

  dispose() {
    this.personas.forEach(p => {
      p.voices.forEach(v => {
        try {
          v.osc.stop()
        } catch (_) {}
      })
    })
    this.ctx.close()
  }
}