import { PERSONA_STAGES, WAVETABLE_INTENSITY, WAVETABLE_CURVE } from './synth.mjs'

const STATE_COLORS = {
  rut: '#2200ffff', emerging: '#f51870ff', growing: '#13d266ff', taste: '#fffcebff'
}
const HEX_SHORT_LENGTH = 3
const COLOR_COMPONENT_MAX = 255
const INITIAL_GLOBAL_ALPHA = 0.1
const INITIAL_REFINEMENT = 0.5
const ENERGY_DEFAULT = 0.5
const BG_TOP_COLOR = '#000000'
const BG_MID_COLOR = '#001528'
const BG_BOTTOM_COLOR = '#000000'
const BG_MID_STOP = 0.4
const GRID_LINE_COLOR = 'rgba(0, 120, 255, 0.25)'
const GRID_LINE_WIDTH = 1
const GRID_LINE_WIDTH_ENERGY_SCALE = 5.05
const GRID_ALPHA_BASE = 0.15
const GRID_ALPHA_ENERGY_SCALE = 0.85
const HORIZON_Y_FACTOR = 0.3
const VANISHING_X_FACTOR = 0.5
const GRID_NUM_LINES = 24
const TRAIL_MAX_FRAMES = 12
const TRAIL_BASE_GRAVITY = 0.6
const TRAIL_GRAVITY_SCALE = 5.2
const TRAIL_BASE_VELOCITY = 15
const TRAIL_GRAVITY_PIXEL_SCALE = 200
const TRAIL_BASE_ALPHA = 0.25
const TRAIL_ALPHA_DECAY = 0.25
const TRAIL_ALPHA_BIAS = 0.4
const TRAIL_MAX_HEIGHT_MULTIPLIER = 2
const TRAIL_ECHO_COUNT = 3
const TRAIL_ECHO_OFFSET_X = 6
const TRAIL_ECHO_OFFSET_Y = 4
const TRAIL_ECHO_ALPHA_SCALE = 0.6
const NOISE_MIN_ENTROPY = 0.01
const NOISE_COUNT_SCALE = 200
const NOISE_BASE_ALPHA = 0.20
const NOISE_ALPHA_SCALE = 0.25
const NOISE_FILL_COLOR = '#ffffff'
const NOISE_MIN_SIZE = 0.7
const NOISE_SIZE_RANGE = 1.8
const NOISE_ENERGY_BASE = 0.3
const NOISE_ENERGY_SCALE = 0.7
const SQUISH_MIN_ENTROPY = 0.01
const SQUISH_FREQ1_BASE = 0.6
const SQUISH_FREQ1_SCALE = 1.0
const SQUISH_FREQ2_BASE = 0.3
const SQUISH_FREQ2_SCALE = 0.7
const SQUISH_PHASE_OFFSET = 1.7
const SQUISH_OUTPUT_SCALE = 0.5
const MS_TO_SECONDS = 1000
const MIN_LINES = 3
const MAX_LINES = 28
const MIN_CYCLES = 2
const MAX_CYCLES = 10
const TOP_Y_FACTOR = 0.19
const STACK_HEIGHT_FACTOR = 0.55
const BASE_AMP_FACTOR = 0.10
const SAMPLE_COUNT = 400
const REFINEMENT_BOOST_BASE = 0.2
const REFINEMENT_BOOST_SCALE = 0.8
const SATURATION_BASE_SCALE = 0.7
const SATURATION_BLEND_BASE = 0.4
const SATURATION_BLEND_SCALE = 0.6
const LIGHTNESS_BASE_SCALE = 0.7
const LIGHTNESS_BLEND_SCALE = 0.3
const LINE_WIDTH = 2
const DEPTH_AMP_BASE = 0.3
const DEPTH_AMP_SCALE = 0.9
const SQUISH_AMP_REDUCTION = 0.35
const ALPHA_BASE = 0.25
const ALPHA_DEPTH_SCALE = 0.75
const SHADOW_BLUR_BASE = 10
const SHADOW_BLUR_SCALE = 10
const CYCLES_TIME_SCALE = 2.0
const CYCLES_DEPTH_OFFSET = 0.8
const SQUISH_DEPTH_TIME_SCALE = 0.4
const POS_CENTER = 0.5
const BRIGHT_BOOST_SCALE = 3
const JITTER_PHASE_SCALE = 0.5
const TIME_FREQ_SCALE = 1.5
const TWO_PI = Math.PI * 2

function hexToHsl(hex) {
  let h = hex.replace('#', '')
  if (h.length === HEX_SHORT_LENGTH) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const r = parseInt(h.slice(0, 2), 16) / COLOR_COMPONENT_MAX
  const g = parseInt(h.slice(2, 4), 16) / COLOR_COMPONENT_MAX
  const b = parseInt(h.slice(4, 6), 16) / COLOR_COMPONENT_MAX
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let hh, s, l
  l = (max + min) / 2
  if (max === min) {
    hh = 0
    s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        hh = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        hh = (b - r) / d + 2
        break
      default:
        hh = (r - g) / d + 4
        break
    }
    hh /= 6
  }
  return { h: hh * 360, s, l }
}

const STATE_BASE_HSL = {}
for (const key in STATE_COLORS) { STATE_BASE_HSL[key] = hexToHsl(STATE_COLORS[key]) }

const MAX_PARTIALS = PERSONA_STAGES.reduce((m, s) => Math.max(m, s.partials), -Infinity)

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.synth = null
    this.running = false
    this._gridOffset = 0
    this.ctx.globalAlpha = INITIAL_GLOBAL_ALPHA
    this.trails = []
    this.smearAmount = 0
    this.entropyAmount = 0
    this.refinementAmount = INITIAL_REFINEMENT
    this.energyAmount = ENERGY_DEFAULT
    window.addEventListener('resize', () => this._resize())
    this._resize()
  }

  setSynth(synth) { this.synth = synth }

  setSmear(amount) {
    const a = Math.min(1, Math.max(0, amount))
    this.smearAmount = a
    if (a === 0) this.trails = []
  }

  setEntropy(amount) { this.entropyAmount = Math.min(1, Math.max(0, amount)) }

  setRefinement(amount) { this.refinementAmount = Math.min(1, Math.max(0, amount)) }

  setEnergy(amount) { this.energyAmount = Math.min(1, Math.max(0, amount)) }

  _resize() {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  start() {
    if (this.running) return
    this.running = true
    const loop = () => {
      if (!this.running) return
      this._drawFrame()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  stop() { this.running = false }

  _drawFrame() {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    const time = this.synth ? this.synth.ctx.currentTime : performance.now() / MS_TO_SECONDS
    this._drawBackground(ctx, w, h)
    this._drawTrails(time)
    this._drawWavesStack(ctx, w, h, time)
    this._drawNoiseOverlay(ctx, w, h)
    if (this.smearAmount > 0) this._addTrailFrame(time)
  }

  _drawBackground(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, BG_TOP_COLOR)
    grad.addColorStop(BG_MID_STOP, BG_MID_COLOR)
    grad.addColorStop(1, BG_BOTTOM_COLOR)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.strokeStyle = GRID_LINE_COLOR
    ctx.lineWidth = GRID_LINE_WIDTH + GRID_LINE_WIDTH_ENERGY_SCALE * this.energyAmount
    ctx.globalAlpha = GRID_ALPHA_BASE + GRID_ALPHA_ENERGY_SCALE * this.energyAmount
    const horizonY = h * HORIZON_Y_FACTOR
    const vanishingX = w * VANISHING_X_FACTOR
    const numLines = GRID_NUM_LINES
    for (let i = 0; i <= numLines; i++) {
      const x = (i / numLines) * w
      ctx.beginPath()
      ctx.moveTo(vanishingX, horizonY)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    ctx.restore()
  }

  _addTrailFrame(time) {
    const off = document.createElement('canvas')
    off.width = this.canvas.width
    off.height = this.canvas.height
    const octx = off.getContext('2d')
    octx.drawImage(this.canvas, 0, 0)
    this.trails.push({ image: off, t0: time })
    const maxFrames = TRAIL_MAX_FRAMES
    if (this.trails.length > maxFrames) this.trails.splice(0, this.trails.length - maxFrames)
  }

  _drawTrails(time) {
    if (this.smearAmount <= 0 || this.trails.length === 0) return
    const ctx = this.ctx
    const gravity = TRAIL_BASE_GRAVITY + TRAIL_GRAVITY_SCALE * this.smearAmount
    const baseVel = TRAIL_BASE_VELOCITY
    const alive = []
    for (const trail of this.trails) {
      const dt = time - trail.t0
      const y = baseVel * dt + 0.5 * (gravity * TRAIL_GRAVITY_PIXEL_SCALE) * dt * dt
      let alpha = TRAIL_BASE_ALPHA - dt * TRAIL_ALPHA_DECAY * (TRAIL_ALPHA_BIAS + this.smearAmount)
      if (alpha <= 0 || y > this.canvas.height * TRAIL_MAX_HEIGHT_MULTIPLIER) continue
      alive.push(trail)
      ctx.save()
      for (let i = 0; i < TRAIL_ECHO_COUNT; i++) {
        const ax = Math.max(0, alpha * Math.pow(TRAIL_ECHO_ALPHA_SCALE, i))
        if (ax <= 0) continue
        ctx.globalAlpha = ax
        const ox = i * TRAIL_ECHO_OFFSET_X
        const oy = y + i * TRAIL_ECHO_OFFSET_Y
        ctx.drawImage(trail.image, ox, oy)
      }
      ctx.restore()
    }
    this.trails = alive
  }

  _drawNoiseOverlay(ctx, w, h) {
    const e = this.entropyAmount
    if (e <= NOISE_MIN_ENTROPY) return
    const count = Math.floor(
      NOISE_COUNT_SCALE * e * e * (NOISE_ENERGY_BASE + NOISE_ENERGY_SCALE * this.energyAmount)
    )
    ctx.save()
    ctx.globalAlpha = NOISE_BASE_ALPHA + NOISE_ALPHA_SCALE * e
    ctx.fillStyle = NOISE_FILL_COLOR
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w
      const y = Math.random() * h
      const size = NOISE_MIN_SIZE + NOISE_SIZE_RANGE * Math.random()
      ctx.fillRect(x, y, size, size)
    }
    ctx.restore()
  }

  _computeSquish(time) {
    const e = this.entropyAmount
    if (e <= SQUISH_MIN_ENTROPY) return 0
    const s1 = SQUISH_FREQ1_BASE + SQUISH_FREQ1_SCALE * e
    const s2 = SQUISH_FREQ2_BASE + SQUISH_FREQ2_SCALE * e
    const a = Math.sin(time * s1) + Math.sin(time * s2 + SQUISH_PHASE_OFFSET)
    return SQUISH_OUTPUT_SCALE * a * e
  }

  _drawWavesStack(ctx, w, h, time) {
    if (!this.synth) return
    const state = this.synth.getState()
    const dominantId = state.dominant.id || ''
    const normalizedId = dominantId.toLowerCase()
    const baseHsl = STATE_BASE_HSL[normalizedId] || STATE_BASE_HSL.rut
    const weights = state.weights || []
    const richnessNorm = Math.min(1, Math.max(0, state.richnessNorm || 0))
    const wavetablePos = typeof state.wavetablePos === 'number' ? Math.min(1, Math.max(0, state.wavetablePos)) : 0
    const minLines = MIN_LINES
    const maxLines = MAX_LINES
    let lineCount = Math.round(minLines + richnessNorm * (maxLines - minLines))
    const energyFactor = 0.5 + 0.8 * this.energyAmount
    lineCount = Math.round(lineCount * energyFactor)
    if (lineCount < minLines) lineCount = minLines
    if (lineCount > maxLines) lineCount = maxLines
    const minCycles = MIN_CYCLES
    const maxCycles = MAX_CYCLES
    const baseCycles = minCycles + richnessNorm * (maxCycles - minCycles)
    const squish = this._computeSquish(time)
    const cycles = baseCycles * (1 + 0.5 * squish)
    const topY = h * TOP_Y_FACTOR
    const stackHeight = h * STACK_HEIGHT_FACTOR
    const baseAmp = h * BASE_AMP_FACTOR
    const samples = SAMPLE_COUNT
    const refinementBoost = REFINEMENT_BOOST_BASE + REFINEMENT_BOOST_SCALE * this.refinementAmount
    const rb = this.refinementAmount
    const s0 = baseHsl.s * SATURATION_BASE_SCALE
    const s = Math.min(1, s0 + (baseHsl.s - s0) * (SATURATION_BLEND_BASE + SATURATION_BLEND_SCALE * rb))
    const l = Math.min(1, baseHsl.l * (LIGHTNESS_BASE_SCALE + LIGHTNESS_BLEND_SCALE * rb))
    const color = `hsl(${baseHsl.h.toFixed(1)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = LINE_WIDTH
    ctx.shadowColor = color
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const depth = lineCount <= 1 ? 0 : lineIndex / (lineCount - 1)
      const yCenter = topY + depth * stackHeight
      const squishAmpFactor = 1 - SQUISH_AMP_REDUCTION * squish
      const amp = baseAmp * (DEPTH_AMP_BASE + DEPTH_AMP_SCALE * depth) * squishAmpFactor
      let alpha = (ALPHA_BASE + ALPHA_DEPTH_SCALE * depth) * refinementBoost
      alpha = Math.min(1, alpha)
      const maxPartialScale = 0.3 + 2.7 * depth
      const maxPartial = 1 + Math.round(maxPartialScale * (MAX_PARTIALS - 1))
      ctx.beginPath()
      ctx.globalAlpha = alpha
      ctx.shadowBlur = (SHADOW_BLUR_BASE + SHADOW_BLUR_SCALE * depth) * refinementBoost
      for (let i = 0; i <= samples; i++) {
        const tNorm = i / samples
        const x = tNorm * w
        const theta = tNorm * TWO_PI * cycles + time * CYCLES_TIME_SCALE + depth * CYCLES_DEPTH_OFFSET
        const sample = this._sampleWave(theta, time + depth * SQUISH_DEPTH_TIME_SCALE, weights, maxPartial, wavetablePos)
        const y = yCenter + amp * sample
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  _sampleWave(theta, time, weights, maxPartial, wavetablePos) {
    const entropy = this.entropyAmount
    let sample = 0
    let pos = Math.min(1, Math.max(0, wavetablePos || 0))
    let p = Math.pow(pos, WAVETABLE_CURVE)
    let personaSample = 0
    p = POS_CENTER + (p - POS_CENTER) * WAVETABLE_INTENSITY
    p = Math.min(1, Math.max(0, p))
    for (let i = 0; i < PERSONA_STAGES.length; i++) {
      const weight = weights[i] || 0
      if (weight <= 0) continue
      const stagePartials = PERSONA_STAGES[i].partials
      const effectivePartials = Math.min(stagePartials, maxPartial)
      for (let n = 1; n <= effectivePartials; n++) {
        const sineAmp = (n === 1) ? 1 : 0
        const triAmp = (n % 2 === 1) ? ((n % 4 === 1 ? 1 : -1) / (n * n)) : 0
        const sawAmp = 1 / n
        const brightBoost = 1 + BRIGHT_BOOST_SCALE * (n / effectivePartials)
        const brightAmp = (1 / n) * brightBoost
        let amp
        if (p < 1 / 3) {
          const t = p / (1 / 3)
          amp = sineAmp * (1 - t) + triAmp * t
        } else if (p < 2 / 3) {
          const t = (p - 1 / 3) / (1 / 3)
          amp = triAmp * (1 - t) + sawAmp * t
        } else {
          const t = (p - 2 / 3) / (1 / 3)
          amp = sawAmp * (1 - t) + brightAmp * t
        }
        const jitterPhase = (Math.random() - 0.5) * entropy * JITTER_PHASE_SCALE
        const phase = theta * n + time * n * TIME_FREQ_SCALE + jitterPhase
        personaSample += Math.sin(phase) * amp
      }
      sample += weight * personaSample
    }
    return Math.tanh(sample)
  }
}