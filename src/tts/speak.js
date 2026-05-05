'use strict';

const { exec, spawn } = require('child_process');
const { promisify }   = require('util');
const fs              = require('fs-extra');
const path            = require('path');
const axios           = require('axios');
const execAsync       = promisify(exec);

// ─── TEJAS VOICE ENGINE v2 ────────────────────────────────────────────────────
// Architecture:
//   Microphone → arecord → Groq Whisper API → Brain → Piper TTS → Speaker
//
// STT: Groq Whisper Large v3 (cloud, zero disk, best quality in world)
// TTS: Piper neural (local, already installed, deep male voice)
//
// Why Groq Whisper API:
//   ✓ Zero disk space (no model download)
//   ✓ Whisper Large v3 = best STT quality available
//   ✓ Uses your existing Groq API key
//   ✓ Fast — same Groq 300 tok/sec infrastructure
//   ✓ Free tier is generous

// ─── PIPER VOICES ─────────────────────────────────────────────────────────────
const PIPER_VOICES = {
  primary:  '~/.local/share/piper/en_US-ryan-high.onnx',
  fallback: '~/.local/share/piper/en_US-lessac-high.onnx',
  arctic:   '~/.local/share/piper/en_US-arctic-medium.onnx',
};

// ─── TEJAS PERSONALITY ────────────────────────────────────────────────────────
const TEJAS_PHRASES = {
  startup: [
    'Tejas online. Ready, Sir.',
    'Systems active. Awaiting your command, Sir.',
    'Tejas operational. How can I assist?',
    'All systems go. What do you need, Sir?',
    'Online and standing by.',
  ],
  activation: [
    'Yes Sir. State your task.',
    'Ready. What shall I do, Sir?',
    'Listening. Go ahead.',
    'At your service, Sir.',
    'I am here. Speak your command.',
  ],
  thinking: [
    'Processing, Sir.',
    'On it.',
    'Executing.',
    'Working on it, Sir.',
    'Understood. Running now.',
  ],
  done_success: [
    'Task complete, Sir.',
    'Done.',
    'Executed successfully.',
    'Complete. Anything else, Sir?',
    'Finished.',
  ],
  done_fail: [
    'I hit an issue, Sir. Check the terminal.',
    'That failed. Terminal has more details.',
    'Could not complete. See terminal for info.',
  ],
  shutdown: [
    'Tejas offline. Goodbye, Sir.',
    'Shutting down.',
    'Going offline. Goodbye.',
  ],
  no_hear: [
    'I did not catch that, Sir. Please repeat.',
    'Could you say that again, Sir?',
    'Pardon, Sir. I missed that.',
  ]
};

// ─── VOICE ENGINE ─────────────────────────────────────────────────────────────
class VoiceEngine {
  constructor(options = {}) {
    this.wakeWord      = (options.wakeWord || 'tejas').toLowerCase();
    this.ttsEngine     = options.ttsEngine || 'auto';
    this.sttEngine     = options.sttEngine || 'groq'; // groq whisper API = default
    this.isListening   = false;
    this.isSpeaking    = false;
    this.onCommand     = options.onCommand  || null;
    this.onWakeWord    = options.onWakeWord || null;
    this.onSpeaking    = options.onSpeaking || null;
    this.groqApiKey    = options.groqApiKey || process.env.GROQ_API_KEY || null;
    this._ttsAvailable = null;
    this._sttAvailable = null;
    this._piperModel   = null;
  }

  // ── INITIALIZE ────────────────────────────────────────────────────────────
  async init() {
    this._ttsAvailable = await this._detectTTS();
    this._sttAvailable = await this._detectSTT();
    this._piperModel   = await this._detectPiperModel();

    // 🔊 Warm-up + Audio Ready Check (Prevents VM startup stutter)
    if (this._ttsAvailable) {
      await this._tts(' ', this._ttsAvailable, { timeout: 2000 }).catch(() => {});
    }

    return {
      tts:        this._ttsAvailable,
      stt:        this._sttAvailable,
      ready:      !!this._ttsAvailable,
      wakeWord:   this.wakeWord,
      piperModel: this._piperModel
    };
  }

  // ── SPEAK ─────────────────────────────────────────────────────────────────
  async speak(text, options = {}) {
    if (!text) return;
    const clean = this._cleanForSpeech(text, options.mode || 'normal');
    if (this.onSpeaking) this.onSpeaking(clean);
    this.isSpeaking = true;
    try {
      await this._tts(clean, this._ttsAvailable || 'espeak', options);
    } catch {
      // silent fail — text still shown in terminal
    }
    this.isSpeaking = false;
  }

  // ── LISTEN ONCE ───────────────────────────────────────────────────────────
  async listenOnce(timeoutMs = 8000) {
    const engine = this._sttAvailable;
    if (!engine) throw new Error('No STT available. Set GROQ_API_KEY or install vosk.');
    return this._stt(engine, timeoutMs);
  }

  // ── WAKE WORD LOOP — always on ────────────────────────────────────────────
  async startWakeWordLoop(onCommand) {
    this.isListening = true;
    this.onCommand   = onCommand;

    await this.speak(this._phrase('startup'));
    console.log(`
  Listening for wake word: "${this.wakeWord.toUpperCase()}"
`);

    while (this.isListening) {
      try {
        // Short listen window for wake word detection
        const heard = await this._recordAndTranscribe(4000);
        if (!heard || heard.length < 2) continue;

        const lower = heard.toLowerCase().trim();
        if (lower.includes(this.wakeWord)) {
          await this._handleWakeWord(lower);
        }
      } catch {
        await this._sleep(300);
      }
    }
  }

  // ── HANDLE WAKE WORD ──────────────────────────────────────────────────────
  async _handleWakeWord(fullText) {
    if (this.onWakeWord) this.onWakeWord();

    // Check if command came with wake word (e.g. "Tejas close firefox")
    const afterWW = fullText
      .replace(new RegExp(this.wakeWord, 'gi'), '')
      .trim();

    let command = afterWW;

    // If nothing after wake word — listen for command
    if (!command || command.length < 3) {
      await this.speak(this._phrase('activation'));
      command = await this._recordAndTranscribe(10000);
    }

    if (!command || command.length < 2) {
      await this.speak(this._phrase('no_hear'));
      return;
    }

    await this.speak(this._phrase('thinking'));
    if (this.onCommand) await this.onCommand(command);
  }

  // ── STT ROUTER ────────────────────────────────────────────────────────────
  async _stt(engine, timeoutMs) {
    return this._recordAndTranscribe(timeoutMs);
  }

  // ── RECORD + TRANSCRIBE (main STT method) ─────────────────────────────────
  async _recordAndTranscribe(timeoutMs = 8000) {
    const tmp     = `/tmp/tejas_audio_${Date.now()}.wav`;
    const seconds = Math.max(2, Math.floor(timeoutMs / 1000));

    try {
      // Record audio using arecord (already installed on Kali)
      await execAsync(
        `arecord -d ${seconds} -f S16_LE -r 16000 -c 1 "${tmp}" 2>/dev/null`,
        { timeout: (seconds + 3) * 1000 }
      );

      if (!await fs.pathExists(tmp)) return '';

      const stat = await fs.stat(tmp);
      if (stat.size < 1000) return ''; // too small = silence

      // Try Groq Whisper API first (best quality, no disk space)
      if (this.groqApiKey) {
        const result = await this._transcribeGroq(tmp);
        if (result) return result;
      }

      // Fallback: Vosk (if installed)
      const vosk = await this._transcribeVosk(tmp).catch(() => '');
      if (vosk) return vosk;

      return '';
    } finally {
      await fs.remove(tmp).catch(() => {});
    }
  }

  // ── GROQ WHISPER API ──────────────────────────────────────────────────────
  // Uses Groq's cloud Whisper Large v3 — best STT, zero disk, free
  async _transcribeGroq(audioFile) {
    try {
      const FormData = require('form-data');
      const form     = new FormData();
      form.append('file', fs.createReadStream(audioFile), {
        filename:    'audio.wav',
        contentType: 'audio/wav'
      });
      form.append('model', 'whisper-large-v3');
      form.append('language', 'en');
      form.append('response_format', 'json');

      const res = await axios.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${this.groqApiKey}`
          },
          timeout: 15000
        }
      );

      return res.data?.text?.trim() || '';
    } catch (err) {
      // API failed — fall through to vosk
      return '';
    }
  }

  // ── VOSK FALLBACK (offline) ───────────────────────────────────────────────
  async _transcribeVosk(audioFile) {
    const { stdout } = await execAsync(`python3 -c "
import json, sys
try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    import wave
    SetLogLevel(-1)
    wf = wave.open('${audioFile}', 'rb')
    m  = Model(lang='en-us')
    rec = KaldiRecognizer(m, wf.getframerate())
    while True:
        data = wf.readframes(4000)
        if len(data) == 0: break
        rec.AcceptWaveform(data)
    print(json.loads(rec.FinalResult()).get('text',''))
except: print('')
" 2>/dev/null`, { timeout: 20000 });
    return stdout.trim();
  }

  // ── TTS ROUTER ────────────────────────────────────────────────────────────
  async _tts(text, engine, options = {}) {
    const t = text.slice(0, options.maxChars || 500);
    switch (engine) {
      case 'piper':    return this._speakPiper(t, options);
      case 'festival': return this._speakFestival(t);
      case 'espeak':   return this._speakEspeak(t, options);
      default:         return this._speakEspeak(t, options);
    }
  }

  // ── PIPER TTS (neural male voice) ────────────────────────────────────────
  async _speakPiper(text, options = {}) {
    const model = this._piperModel;
    if (!model) throw new Error('No Piper model found');
    const cmd = `echo "${text.replace(/"/g, '"')}" | piper --model "${model}" --output-raw | aplay -r 22050 -f S16_LE -c 1 2>/dev/null`;
    await execAsync(cmd, { timeout: 30000 });
  }

  // ── FESTIVAL TTS ──────────────────────────────────────────────────────────
  async _speakFestival(text) {
    await execAsync(`echo "${text.replace(/"/g, '"')}" | festival --tts 2>/dev/null`, { timeout: 15000 });
  }

  // ── ESPEAK TTS (fallback) ─────────────────────────────────────────────────
  async _speakEspeak(text, options = {}) {
    const speed = options.speed || 150;
    const pitch = options.pitch || 40;
    await execAsync(
      `espeak-ng -s ${speed} -p ${pitch} "${text.replace(/"/g, '"')}" 2>/dev/null || espeak "${text.replace(/"/g, '"')}" 2>/dev/null`,
      { timeout: 15000 }
    );
  }

  // ── DETECT TTS ────────────────────────────────────────────────────────────
  async _detectTTS() {
    try {
      const { stdout } = await execAsync('which piper', { timeout: 3000 });
      if (stdout.trim() && await this._detectPiperModel()) return 'piper';
    } catch {}
    try {
      const { stdout } = await execAsync('which festival', { timeout: 3000 });
      if (stdout.trim()) return 'festival';
    } catch {}
    try {
      await execAsync('which espeak-ng || which espeak', { timeout: 3000 });
      return 'espeak';
    } catch {}
    return null;
  }

  // ── DETECT PIPER MODEL ────────────────────────────────────────────────────
  async _detectPiperModel() {
    const home = process.env.HOME || '/home/kali';
    const ryanHighModelPath = path.join(home, '.local/share/piper/en_US-ryan-high.onnx');
    if (await fs.pathExists(ryanHighModelPath)) {
      return ryanHighModelPath;
    }

    const candidates = [
      path.join(home, '.local/share/piper/en_US-ryan-high.onnx'),
      path.join(home, '.local/share/piper/en_US-arctic-medium.onnx'),
      path.join(home, '.local/share/piper/en_US-lessac-high.onnx'),
      path.join(home, '.local/share/piper/en_GB-alan-medium.onnx'),
    ];
    for (const p of candidates) {
      if (await fs.pathExists(p)) return p;
    }
    const piperDir = path.join(home, '.local/share/piper');
    if (await fs.pathExists(piperDir)) {
      const files = await fs.readdir(piperDir);
      const model = files.find(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
      if (model) return path.join(piperDir, model);
    }
    return null;
  }

  // ── DETECT STT ────────────────────────────────────────────────────────────
  async _detectSTT() {
    // 1. Groq API key — best option, no install needed
    const groqKey = this.groqApiKey || process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        await execAsync('which arecord', { timeout: 3000 });
        return 'groq'; // arecord + groq whisper API
      } catch {}
    }

    // 2. Vosk — offline fallback
    try {
      const { stdout } = await execAsync(
        'python3 -c "import vosk; print(\'ok\')" 2>/dev/null',
        { timeout: 5000 }
      );
      if (stdout.trim() === 'ok') return 'vosk';
    } catch {}

    return null;
  }

  // ── CLEAN TEXT FOR SPEECH ─────────────────────────────────────────────────
  _cleanForSpeech(text, mode = 'normal') {
    let clean = text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`[^`]+`/g, m => m.replace(/`/g, ''))
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'link')
      .replace(/[^\w\s.,!?;:'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (mode === 'summary') {
      const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
      clean = sentences.slice(0, 2).join(' ');
    }
    return clean;
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  _phrase(type) {
    const list = TEJAS_PHRASES[type] || ['Ready.'];
    return list[Math.floor(Math.random() * list.length)];
  }

  getActivationPhrase()           { return this._phrase('activation'); }
  getThinkingPhrase()             { return this._phrase('thinking'); }
  getCompletionPhrase(_, success) { return this._phrase(success ? 'done_success' : 'done_fail'); }
  getShutdownPhrase()             { return this._phrase('shutdown'); }
  getStartupPhrase()              { return this._phrase('startup'); }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  stop()     { this.isListening = false; }
}

module.exports = VoiceEngine;
