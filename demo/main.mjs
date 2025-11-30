import { PersonaWavetableSynth, PERSONA_STAGES } from '../synth.mjs'
import { Visualizer } from '../visualizer.mjs'

const canvas = document.getElementById('scene')
const startButton = document.getElementById('start')
const slider = document.getElementById('persona')
const stageLabel = document.getElementById('stageLabel')
const delayControl = document.getElementById('delayControl')
const entropyControl = document.getElementById('entropyControl')
const refinementControl = document.getElementById('refinementControl')
const personaLfoDepth = document.getElementById('personaLfoDepth')
const delayLfoDepth = document.getElementById('delayLfoDepth')
const entropyLfoDepth = document.getElementById('entropyLfoDepth')
const refinementLfoDepth = document.getElementById('refinementLfoDepth')
const rootNoteInput = document.getElementById('rootNote')
const noteUpButton = document.getElementById('noteUp')
const noteDownButton = document.getElementById('noteDown')
const wavetablePos = document.getElementById('wavetablePos')
const TRANSPOSE_SEMITONES = -7
const NOTE_OFFSETS = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 }
const TWO_PI = Math.PI * 2
const A4_HZ = 440
const A4_MIDI = 69
const SEMITONES_PER_OCTAVE = 12
const MIN_MIDI_NOTE = 12
const MAX_MIDI_NOTE = 108
const DEFAULT_ROOT_OCTAVE = 3
const DEFAULT_ROOT_MIDI = 60
const FALLBACK_STEP_ROOT_MIDI = 57
const MIN_ROOT_MIDI = 24
const MAX_ROOT_MIDI = 96
const MS_TO_SECONDS = 1000
const DEFAULT_REFINEMENT_BASE = 0.5
const MIDI_STATUS_MASK = 0xf0
const MIDI_NOTE_ON = 0x90
const LFO_JUMP_PROB_PER_SEC = 0.15
const LFO_AMPLITUDE_SCALE = 0.5
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_REGEX = /^([a-g])([#b]?)(\d+)?$/
const DEFAULT_PERSONA_LFO_DEPTH = 0.25
const DEFAULT_PERSONA_LFO_FREQ = 0.03
const DEFAULT_PERSONA_LFO_MIN_FREQ = 0.005
const DEFAULT_PERSONA_LFO_MAX_FREQ = 0.20
const DEFAULT_PERSONA_LFO_JITTER = 0.8
const DEFAULT_DELAY_LFO_DEPTH = 0.2
const DEFAULT_DELAY_LFO_FREQ = 0.04
const DEFAULT_DELAY_LFO_MIN_FREQ = 0.008
const DEFAULT_DELAY_LFO_MAX_FREQ = 0.25
const DEFAULT_DELAY_LFO_JITTER = 1.0
const DEFAULT_ENTROPY_LFO_DEPTH = 0.15
const DEFAULT_ENTROPY_LFO_FREQ = 0.05
const DEFAULT_ENTROPY_LFO_MIN_FREQ = 0.01
const DEFAULT_ENTROPY_LFO_MAX_FREQ = 0.30
const DEFAULT_ENTROPY_LFO_JITTER = 1.2
const DEFAULT_REFINEMENT_LFO_DEPTH = 0.15
const DEFAULT_REFINEMENT_LFO_FREQ = 0.02
const DEFAULT_REFINEMENT_LFO_MIN_FREQ = 0.004
const DEFAULT_REFINEMENT_LFO_MAX_FREQ = 0.16
const DEFAULT_REFINEMENT_LFO_JITTER = 0.7
const lfoState = {
  persona: {
    base: Number(slider.value) || 0,
    depth: personaLfoDepth ? Number(personaLfoDepth.value) || 0 : DEFAULT_PERSONA_LFO_DEPTH,
    phase: Math.random() * TWO_PI,
    freq: DEFAULT_PERSONA_LFO_FREQ,
    minFreq: DEFAULT_PERSONA_LFO_MIN_FREQ,
    maxFreq: DEFAULT_PERSONA_LFO_MAX_FREQ,
    jitter: DEFAULT_PERSONA_LFO_JITTER
  },
  delay: {
    base: Number(delayControl.value) || 0,
    depth: delayLfoDepth ? Number(delayLfoDepth.value) || 0 : DEFAULT_DELAY_LFO_DEPTH,
    phase: Math.random() * TWO_PI,
    freq: DEFAULT_DELAY_LFO_FREQ,
    minFreq: DEFAULT_DELAY_LFO_MIN_FREQ,
    maxFreq: DEFAULT_DELAY_LFO_MAX_FREQ,
    jitter: DEFAULT_DELAY_LFO_JITTER
  },
  entropy: {
    base: Number(entropyControl.value) || 0,
    depth: entropyLfoDepth ? Number(entropyLfoDepth.value) || 0 : DEFAULT_ENTROPY_LFO_DEPTH,
    phase: Math.random() * TWO_PI,
    freq: DEFAULT_ENTROPY_LFO_FREQ,
    minFreq: DEFAULT_ENTROPY_LFO_MIN_FREQ,
    maxFreq: DEFAULT_ENTROPY_LFO_MAX_FREQ,
    jitter: DEFAULT_ENTROPY_LFO_JITTER
  },
  refinement: {
    base: Number(refinementControl.value) || DEFAULT_REFINEMENT_BASE,
    depth: refinementLfoDepth ? Number(refinementLfoDepth.value) || 0 : DEFAULT_REFINEMENT_LFO_DEPTH,
    phase: Math.random() * TWO_PI,
    freq: DEFAULT_REFINEMENT_LFO_FREQ,
    minFreq: DEFAULT_REFINEMENT_LFO_MIN_FREQ,
    maxFreq: DEFAULT_REFINEMENT_LFO_MAX_FREQ,
    jitter: DEFAULT_REFINEMENT_LFO_JITTER
  }
}
const visualizer = new Visualizer(canvas)
visualizer.start()
let synth = null
let currentRootMidi = null
let midiAccess = null
let lastTime = performance.now() / MS_TO_SECONDS

function applyWavetable(value) {
  const v = clamp01(value)
  if (wavetablePos) wavetablePos.value = v
  if (synth && typeof synth.setWavetablePos === 'function') synth.setWavetablePos(v)
}

if (wavetablePos) {
  wavetablePos.addEventListener('input', () => {
    const v = Number(wavetablePos.value)
    if (!Number.isFinite(v)) return
    applyWavetable(v)
    updateHashFromUI()
  })
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }

function midiToHz(midi) { return A4_HZ * Math.pow(2, (midi + TRANSPOSE_SEMITONES - A4_MIDI) / SEMITONES_PER_OCTAVE) }

function midiToNoteName(midi) {
  const clamped = Math.max(MIN_MIDI_NOTE, Math.min(MAX_MIDI_NOTE, midi))
  const octave = Math.floor(clamped / SEMITONES_PER_OCTAVE) - 1
  const semitone = clamped % SEMITONES_PER_OCTAVE
  const NAMES = NOTE_NAMES
  return `${NAMES[semitone]}${octave}`
}

function parseNoteToMidi(str) {
  if (!str) return null
  const s = String(str).trim().toLowerCase(), m = NOTE_REGEX.exec(s)
  if (!m) return null
  let [, letter, acc, octStr] = m
  let key = letter
  if (acc === '#' || acc === 'b') key += acc
  const semi = NOTE_OFFSETS[key]
  if (semi == null) return null
  const octave = octStr != null ? parseInt(octStr, 10) : DEFAULT_ROOT_OCTAVE
  if (!Number.isFinite(octave)) return null
  const midi = (octave + 1) * SEMITONES_PER_OCTAVE + semi
  return midi
}

function initSynthIfNeeded() {
  if (synth) return
  synth = new PersonaWavetableSynth()
  visualizer.setSynth(synth)
  if (rootNoteInput) {
    let midi = parseNoteToMidi(rootNoteInput.value)
    if (midi == null) midi = DEFAULT_ROOT_MIDI
    currentRootMidi = midi
    const hz = midiToHz(midi)
    if (typeof synth.setRootHz === 'function') synth.setRootHz(hz)
    rootNoteInput.value = midiToNoteName(midi)
  }
  const delayVal = Number(delayControl.value) || 0, entropyVal = Number(entropyControl.value) || 0
  const refineVal = Number(refinementControl.value) || DEFAULT_REFINEMENT_BASE
  synth.setDelay(delayVal)
  synth.setEntropy(entropyVal)
  synth.setRefinement(refineVal)
  visualizer.setSmear(delayVal)
  visualizer.setEntropy(entropyVal)
  visualizer.setRefinement(refineVal)
}

function updateLabels() {
  if (!stageLabel) return
  if (!synth) {
    const tRaw = Number(slider && slider.value), t = clamp01(Number.isFinite(tRaw) ? tRaw : 0)
    let closest = PERSONA_STAGES[0], bestDist = Infinity
    for (const s of PERSONA_STAGES) {
      const d = Math.abs(t - s.position)
      if (d < bestDist) {
        bestDist = d
        closest = s
      }
    }
    stageLabel.textContent = `${closest.id}`
    return
  }
  const state = synth.getState(), dominant = state.dominant
  const id = dominant && dominant.id ? dominant.id : 'Rut'
  stageLabel.textContent = `${id}`
}

function updatePlayButtonLabel() {
  if (!synth) {
    startButton.textContent = 'Play'
    togglePlay()
  } else if (synth.ctx.state === 'suspended') {
    startButton.textContent = 'Play'
  } else if (synth.ctx.state === 'running') {
    startButton.textContent = 'Pause'
  }
}

async function togglePlay() {
  initSynthIfNeeded()
  if (!synth) return
  if (synth.ctx.state === 'running') {
    await synth.pause()
  } else if (synth.ctx.state === 'suspended') {
    await synth.resume()
  } else {
    togglePlay()
  }
  updatePlayButtonLabel()
  updateLabels()
}

function applyPersona(value) {
  const v = clamp01(value)
  slider.value = v
  if (synth) {
    synth.setValue(v)
    updateLabels()
  }
}

function applyDelay(value) {
  const v = clamp01(value)
  delayControl.value = v
  visualizer.setSmear(v)
  if (synth) synth.setDelay(v)
}

function applyEntropy(value) {
  const v = clamp01(value)
  entropyControl.value = v
  visualizer.setEntropy(v)
  if (synth) synth.setEntropy(v)
}

function applyRefinement(value) {
  const v = clamp01(value)
  refinementControl.value = v
  visualizer.setRefinement(v)
  if (synth) synth.setRefinement(v)
}

function setRootFromMidi(midi) {
  if (midi == null) return
  const minMidi = MIN_ROOT_MIDI, maxMidi = MAX_ROOT_MIDI
  const clamped = Math.max(minMidi, Math.min(maxMidi, midi))
  currentRootMidi = clamped
  if (rootNoteInput) rootNoteInput.textContent = midiToNoteName(clamped)
  initSynthIfNeeded()
  if (synth && typeof synth.setRootHz === 'function') synth.setRootHz(midiToHz(clamped))
}

function setRootFromInput() {
  if (!rootNoteInput) return
  let midi = parseNoteToMidi(rootNoteInput.value)
  if (midi == null) return
  setRootFromMidi(midi)
}

function stepRoot(deltaSemitones) {
  if (currentRootMidi == null) {
    let midi = parseNoteToMidi(rootNoteInput && rootNoteInput.value)
    if (midi == null) midi = FALLBACK_STEP_ROOT_MIDI
    currentRootMidi = midi
  }
  setRootFromMidi(currentRootMidi + deltaSemitones)
}

function initMIDI() {
  if (!('requestMIDIAccess' in navigator)) return
  navigator.requestMIDIAccess().then(
    access => {
      midiAccess = access
      attachMIDIInputs(access)
      access.onstatechange = () => attachMIDIInputs(access)
    },
    () => { }
  )
}

function attachMIDIInputs(access) {
  if (!access || !access.inputs) return
  for (const input of access.inputs.values()) { input.onmidimessage = handleMIDIMessage }
}

function handleMIDIMessage(event) {
  const data = event.data
  if (!data || data.length < 2) return
  const status = data[0] & MIDI_STATUS_MASK, note = data[1], velocity = data[2] || 0
  if (status === MIDI_NOTE_ON && velocity > 0) {
    setRootFromMidi(note)
    updateHashFromUI()
  }
}

if (personaLfoDepth) personaLfoDepth.addEventListener('input', () => { lfoState.persona.depth = Number(personaLfoDepth.value) || 0; updateHashFromUI() })
if (delayLfoDepth) delayLfoDepth.addEventListener('input', () => { lfoState.delay.depth = Number(delayLfoDepth.value) || 0; updateHashFromUI() })
if (entropyLfoDepth) entropyLfoDepth.addEventListener('input', () => { lfoState.entropy.depth = Number(entropyLfoDepth.value) || 0; updateHashFromUI() })
if (refinementLfoDepth) refinementLfoDepth.addEventListener('input', () => { lfoState.refinement.depth = Number(refinementLfoDepth.value) || 0; updateHashFromUI() })

function updateLfoParam(name, applyFn, dt) {
  const s = lfoState[name]
  if (!s || s.depth <= 0) return
  const drift = (Math.random() - 0.5) * s.jitter * dt
  let newFreq = s.freq + drift
  if (newFreq < s.minFreq) newFreq = s.minFreq
  if (newFreq > s.maxFreq) newFreq = s.maxFreq
  if (Math.random() < LFO_JUMP_PROB_PER_SEC * dt) newFreq = s.minFreq + Math.random() * (s.maxFreq - s.minFreq)
  s.freq = newFreq
  s.phase += TWO_PI * s.freq * dt
  const sinus = Math.sin(s.phase), amplitude = s.depth * LFO_AMPLITUDE_SCALE, value = s.base + sinus * amplitude
  applyFn(value)
}

function stepLfo() {
  const now = performance.now() / MS_TO_SECONDS, dt = now - lastTime
  lastTime = now
  if (dt > 0) {
    updateLfoParam('persona', applyPersona, dt)
    updateLfoParam('delay', applyDelay, dt)
    updateLfoParam('entropy', applyEntropy, dt)
    updateLfoParam('refinement', applyRefinement, dt)
  }
  requestAnimationFrame(stepLfo)
}

function getConfigFromUI() {
  const cfg = {}
  if (slider) cfg.p = Number(slider.value) || 0
  if (delayControl) cfg.d = Number(delayControl.value) || 0
  if (entropyControl) cfg.e = Number(entropyControl.value) || 0
  if (refinementControl) cfg.r = Number(refinementControl.value) || 0
  if (personaLfoDepth) cfg.pl = Number(personaLfoDepth.value) || 0
  if (delayLfoDepth) cfg.dl = Number(delayLfoDepth.value) || 0
  if (entropyLfoDepth) cfg.el = Number(entropyLfoDepth.value) || 0
  if (refinementLfoDepth) cfg.rl = Number(refinementLfoDepth.value) || 0
  if (wavetablePos) cfg.w = Number(wavetablePos.value) || 0
  if (rootNoteInput) {
    const txt = rootNoteInput.textContent || rootNoteInput.value || ''
    if (txt && typeof txt === 'string') cfg.rn = txt.trim()
  }
  return cfg
}

function encodeConfig(cfg) {
  const parts = []
  function pushNum(key, v) {
    if (v == null || !Number.isFinite(v)) return
    parts.push(key + '=' + v.toFixed(3))
  }
  pushNum('p', cfg.p)
  pushNum('d', cfg.d)
  pushNum('e', cfg.e)
  pushNum('r', cfg.r)
  pushNum('pl', cfg.pl)
  pushNum('dl', cfg.dl)
  pushNum('el', cfg.el)
  pushNum('rl', cfg.rl)
  pushNum('w', cfg.w)
  if (cfg.rn) parts.push('rn=' + encodeURIComponent(cfg.rn))
  return parts.join('&')
}

function decodeConfig(str) {
  const out = {}
  if (!str) return out
  const s = str.charAt(0) === '#' ? str.slice(1) : str
  if (!s) return out
  const pairs = s.split('&')
  for (const pair of pairs) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const key = pair.slice(0, eq)
    const raw = pair.slice(eq + 1)
    if (key === 'rn') {
      out.rn = decodeURIComponent(raw)
    } else {
      const v = parseFloat(raw)
      if (Number.isFinite(v)) out[key] = v
    }
  }
  return out
}

function applyConfigToUI(cfg) {
  if (!cfg) return
  if (cfg.p != null && slider) {
    const v = Number(cfg.p)
    if (Number.isFinite(v)) {
      if (lfoState.persona) lfoState.persona.base = v
      applyPersona(v)
    }
  }
  if (cfg.d != null && delayControl) {
    const v = Number(cfg.d)
    if (Number.isFinite(v)) {
      if (lfoState.delay) lfoState.delay.base = v
      applyDelay(v)
    }
  }
  if (cfg.e != null && entropyControl) {
    const v = Number(cfg.e)
    if (Number.isFinite(v)) {
      if (lfoState.entropy) lfoState.entropy.base = v
      applyEntropy(v)
    }
  }
  if (cfg.r != null && refinementControl) {
    const v = Number(cfg.r)
    if (Number.isFinite(v)) {
      if (lfoState.refinement) lfoState.refinement.base = v
      applyRefinement(v)
    }
  }
  if (cfg.pl != null && personaLfoDepth) {
    const v = Number(cfg.pl)
    if (Number.isFinite(v)) {
      personaLfoDepth.value = v
      if (lfoState.persona) lfoState.persona.depth = v
    }
  }
  if (cfg.dl != null && delayLfoDepth) {
    const v = Number(cfg.dl)
    if (Number.isFinite(v)) {
      delayLfoDepth.value = v
      if (lfoState.delay) lfoState.delay.depth = v
    }
  }
  if (cfg.el != null && entropyLfoDepth) {
    const v = Number(cfg.el)
    if (Number.isFinite(v)) {
      entropyLfoDepth.value = v
      if (lfoState.entropy) lfoState.entropy.depth = v
    }
  }
  if (cfg.rl != null && refinementLfoDepth) {
    const v = Number(cfg.rl)
    if (Number.isFinite(v)) {
      refinementLfoDepth.value = v
      if (lfoState.refinement) lfoState.refinement.depth = v
    }
  }
  if (cfg.w != null && wavetablePos) {
    const v = Number(cfg.w)
    if (Number.isFinite(v)) applyWavetable(v)
  }
  if (cfg.rn) {
    const midi = parseNoteToMidi(cfg.rn)
    if (midi != null) {
      setRootFromMidi(midi)
    }
  }
  updateLabels()
}

function updateHashFromUI() {
  const cfg = getConfigFromUI()
  const hash = encodeConfig(cfg)
  if (!hash) return
  if ('#' + hash === window.location.hash) return
  window.location.hash = hash
}

function loadConfigFromHash() {
  const raw = window.location.hash
  if (!raw || raw.length <= 1) return
  const cfg = decodeConfig(raw)
  applyConfigToUI(cfg)
}

startButton.addEventListener('click', () => { togglePlay() })
slider.addEventListener('input', () => {
  const t = Number(slider.value)
  if (!Number.isFinite(t)) return
  if (lfoState.persona) lfoState.persona.base = t
  applyPersona(t)
  updateHashFromUI()
})
delayControl.addEventListener('input', () => {
  const v = Number(delayControl.value)
  if (!Number.isFinite(v)) return
  if (lfoState.delay) lfoState.delay.base = v
  applyDelay(v)
  updateHashFromUI()
})
entropyControl.addEventListener('input', () => {
  const v = Number(entropyControl.value)
  if (!Number.isFinite(v)) return
  if (lfoState.entropy) lfoState.entropy.base = v
  applyEntropy(v)
  updateHashFromUI()
})
refinementControl.addEventListener('input', () => {
  const v = Number(refinementControl.value)
  if (!Number.isFinite(v)) return
  if (lfoState.refinement) lfoState.refinement.base = v
  applyRefinement(v)
  updateHashFromUI()
})
if (rootNoteInput) {
  rootNoteInput.addEventListener('change', () => { setRootFromInput(); updateHashFromUI() })
  rootNoteInput.addEventListener('keydown', e => { if (e.key === 'Enter') { setRootFromInput(); updateHashFromUI() } })
}
if (noteUpButton) noteUpButton.addEventListener('click', () => { stepRoot(+1); updateHashFromUI() })
if (noteDownButton) noteDownButton.addEventListener('click', () => { stepRoot(-1); updateHashFromUI() })

updatePlayButtonLabel()
loadConfigFromHash()
updateLabels()
stepLfo()
initMIDI()
window.addEventListener('hashchange', () => { loadConfigFromHash() })