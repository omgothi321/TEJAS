'use strict';

const { exec }      = require('child_process');
const { promisify } = require('util');
const fs            = require('fs-extra');
const path          = require('path');
const axios         = require('axios');
const FormData      = require('form-data');
const execAsync     = promisify(exec);

// ─── TEJAS VOICE ENGINE ───────────────────────────────────────────────────────
// Architecture:
//   Microphone → STT → Task Router → AI → TTS (Piper neural voice)
//
// TTS Priority:
//   1. Piper TTS  ← neural, human, male — PRIMARY
//   2. festival   ← decent quality
//   3. espeak-ng  ← last resort
//
// STT Priority:
//   1. Whisper    ← best quality
//   2. Vosk       ← fully offline
//   3. arecord    ← record only

// ─── PIPER VOICE CONFIG ───────────────────────────────────────────────────────
// Best free male English voices for Piper:
const PIPER_VOICES = {
  // Deep, professional male voice — BEST for Tejas
  primary:  '~/.local/share/piper/en_US-ryan-high.onnx',
  // Fallback male voice
  fallback: '~/.local/share/piper/en_US-lessac-high.onnx',
  // Arctic male voice — very clear
  arctic:   '~/.local/share/piper/en_US-arctic-medium.onnx',
};

// ─── TEJAS PERSONALITY ────────────────────────────────────────────────────────
const TEJAS_PHRASES = {
  startup: [
    'Tejas online. Ready.',
    'Systems active. Awaiting your command.',
    'Tejas operational. How can I assist?',
    'All systems go. What do you need?',
    'Tejas here, how can I help you?',
  ],
  activation: [
    'Yes? State your task.',
    'Ready. What shall I do?',
    'Listening. Go ahead.',
    'At your service.',
    'Command received. Speak.',
  ],
  thinking: [
    'Processing.',
    'On it.',
    'Executing.',
    'Working on it.',
    'Understood. Running now.',
  ],
  done_success: [
    'Task complete.',
    'Done.',
    'Executed successfully.',
    'Complete. Anything else?',
    'Finished.',
  ],
  done_fail: [
    'I hit an issue. Check the terminal.',
    'That failed. See terminal for details.',
    'Could not complete. Terminal has more info.',
  ],
  shutdown: [
    'Tejas offline. Goodbye.',
    'Shutting down. Standing by.',
    'Going offline.',
  ]
};

class VoiceEngine {
  constructor(options = {}) {
    this.wakeWord      = options.wakeWord  || 'tejas';
    this.ttsEngine     = options.ttsEngine || 'auto';
    this.sttEngine     = options.sttEngine || 'auto';
    this.apiKeys       = options.apiKeys   || {};
    this.isListening   = false;
    this.isSpeaking    = false;
    this.onCommand     = options.onCommand  || null;
    this.onWakeWord    = options.onWakeWord || null;
    this.onSpeaking    = options.onSpeaking || null;
    this._ttsAvailable = null;
    this._sttAvailable = null;
    this._piperModel   = null;
    this._piperBin     = null;
  }

  // ── INITIALIZE ────────────────────────────────────────────────────────────
  async init() {
    this._piperBin = await this._findPiperBin();
    this._piperModel = await this._detectPiperModel();
    
    // Set TTS availability based on Piper availability first
    if (this._piperBin && this._piperModel) {
      this._ttsAvailable = 'piper';
    } else {
      this._ttsAvailable = await this._detectTTS();
    }
    
    this._sttAvailable = await this._detectSTT();

    return {
      tts:      this._ttsAvailable,
      stt:      this._sttAvailable,
      ready:    !!this._ttsAvailable,
      wakeWord: this.wakeWord,
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
    } catch (err) {
      // Silent fail — text still shown
    }
    this.isSpeaking = false;
  }

  // ── LISTEN ONCE ───────────────────────────────────────────────────────────
  async listenOnce(timeoutMs = 8000) {
    if (!this._sttAvailable) throw new Error('No STT engine available');
    return this._stt(this._sttAvailable, timeoutMs);
  }

  // ── START WAKE WORD LOOP ──────────────────────────────────────────────────
  async startWakeWordLoop(onCommand) {
    this.isListening = true;
    this.onCommand   = onCommand;
    await this.speak(this._phrase('startup'));

    while (this.isListening) {
      try {
        // Shorter, faster recording cycle (3 sec) for more sensitivity
        const heard = await this.listenOnce(3000);
        if (!heard) continue;
        const lower = heard.toLowerCase().trim();
        
        // Match wake word (e.g., "tejas", "hey tejas", "okay tejas")
        if (lower.includes(this.wakeWord.toLowerCase()) || lower.includes('hey ' + this.wakeWord.toLowerCase())) {
          await this._handleWakeWord(lower);
        }
      } catch {
        await this._sleep(100);
      }
    }
  }

  // ── HANDLE WAKE WORD ──────────────────────────────────────────────────────
  async _handleWakeWord(fullText) {
    if (this.onWakeWord) this.onWakeWord();
    
    // Remove wake word to extract command (e.g., "tejas close firefox" -> "close firefox")
    const lower = fullText.toLowerCase();
    const command = lower.replace(this.wakeWord.toLowerCase(), '').replace('hey ', '').trim();

    // If there's already a command in the same breath, use it
    if (command && command.length > 3) {
      if (this.onCommand) await this.onCommand(command);
      return;
    }

    // Otherwise, ask and listen for command
    await this.speak(this._phrase('activation'));
    const heard = await this.listenOnce(7000);
    if (heard && heard.length > 2) {
      if (this.onCommand) await this.onCommand(heard);
    } else {
      await this.speak('I did not catch that, Sir.');
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  async _tts(text, engine, options = {}) {
    const t = text.slice(0, options.maxChars || 500);
    switch (engine) {
      case 'piper':    return this._speakPiper(t, options);
      case 'festival': return this._speakFestival(t);
      case 'espeak':   return this._speakEspeak(t, options);
      default:         return this._speakEspeak(t, options);
    }
  }

  // ── PIPER TTS (primary — neural male voice) ───────────────────────────────
  async _speakPiper(text, options = {}) {
    const model = this._piperModel;
    const bin   = this._piperBin || 'piper';
    if (!model) throw new Error('No Piper model found');

    const tmpWav = path.join('/tmp', `tejas_voice_${Date.now()}.wav`);
    const safe = text.replace(/"/g, "'").replace(/\$/g, '').replace(/`/g, '');

    try {
      // Generate full WAV first (more stable than piping)
      await execAsync(`echo "${safe}" | ${bin} --model ${model} --output_file ${tmpWav}`, { timeout: 30000 });
      
      // Play using paplay (native for PulseAudio/PipeWire) with stability flags
      // paplay is better than aplay for modern Linux systems to prevent stuttering
      await execAsync(`paplay --name="Tejas" --latency-msec=100 ${tmpWav} 2>/dev/null || aplay ${tmpWav} 2>/dev/null`, { timeout: 30000 });
    } catch (err) {
      // Fallback to espeak if piper fails
      return this._speakEspeak(text, options);
    } finally {
      // Cleanup
      if (await fs.pathExists(tmpWav)) {
        await fs.remove(tmpWav).catch(() => {});
      }
    }
  }

  // ── FESTIVAL TTS ──────────────────────────────────────────────────────────
  async _speakFestival(text) {
    const safe = text.replace(/"/g, "'");
    return execAsync(`echo "${safe}" | festival --tts 2>/dev/null`, { timeout: 30000 });
  }

  // ── ESPEAK (last resort) ──────────────────────────────────────────────────
  async _speakEspeak(text, options = {}) {
    const speed = options.speed  || 145;
    const pitch = options.pitch  || 35;
    const voice = options.voice  || 'en+m3';
    const safe  = text.replace(/"/g, "'").replace(/`/g, '').replace(/\$/g, '');
    const cmd   = `espeak-ng -v "${voice}" -s ${speed} -p ${pitch} "${safe}" 2>/dev/null || espeak -v en -s ${speed} -p ${pitch} "${safe}" 2>/dev/null`;
    return execAsync(cmd, { timeout: 30000 });
  }

  // ── FIND PIPER BINARY ─────────────────────────────────────────────────────
  async _findPiperBin() {
    const candidates = [
      '/home/kali/.local/bin/piper',
      path.join(process.env.HOME || '/home/kali', '.local/bin/piper'),
      '/usr/local/bin/piper',
      '/usr/bin/piper'
    ];
    for (const b of candidates) {
      if (await fs.pathExists(b)) return b;
    }
    try {
      const { stdout } = await execAsync('which piper', { timeout: 2000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  // ── STT ───────────────────────────────────────────────────────────────────
  async _stt(engine, timeoutMs) {
    switch (engine) {
      case 'groq':    return this._listenGroq(timeoutMs);
      case 'whisper': return this._listenWhisper(timeoutMs);
      case 'vosk':    return this._listenVosk(timeoutMs);
      default:        throw new Error('No transcription engine');
    }
  }

  async _listenGroq(timeoutMs) {
    const apiKey = this.apiKeys.groq || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('No Groq API key for voice.');

    const tmp = `/tmp/tejas_voice_${Date.now()}.wav`;
    const seconds = Math.floor(timeoutMs / 1000);

    try {
      await execAsync(`arecord -d ${seconds} -f cd -t wav "${tmp}" 2>/dev/null`, { timeout: timeoutMs + 2000 });
      
      const form = new FormData();
      form.append('file', fs.createReadStream(tmp));
      form.append('model', 'whisper-large-v3');

      const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${apiKey}`
        }
      });

      return res.data.text || '';
    } catch (err) {
      if (err.response) {
        throw new Error(`Groq STT failed: ${err.response.status} ${JSON.stringify(err.response.data)}`);
      }
      throw new Error('Groq STT failed: ' + err.message);
    } finally {
      await fs.remove(tmp).catch(() => {});
    }
  }

  async _listenWhisper(timeoutMs) {
    const tmp     = `/tmp/tejas_${Date.now()}.wav`;
    const seconds = Math.floor(timeoutMs / 1000);
    try {
      await execAsync(`arecord -d ${seconds} -f cd -t wav "${tmp}" 2>/dev/null`, { timeout: timeoutMs + 2000 });
      await execAsync(`whisper "${tmp}" --model tiny --language en --output_format txt --output_dir /tmp 2>/dev/null`, { timeout: 30000 });
      const txtFile = tmp.replace('.wav', '.txt');
      if (await fs.pathExists(txtFile)) {
        const text = await fs.readFile(txtFile, 'utf8');
        await fs.remove(txtFile).catch(() => {});
        return text.trim();
      }
      return '';
    } finally {
      await fs.remove(tmp).catch(() => {});
    }
  }

  async _listenVosk(timeoutMs) {
    const tmp     = `/tmp/tejas_${Date.now()}.wav`;
    const seconds = Math.floor(timeoutMs / 1000);
    try {
      await execAsync(`arecord -d ${seconds} -f cd -t wav "${tmp}" 2>/dev/null`, { timeout: timeoutMs + 2000 });
      const { stdout } = await execAsync(`python3 -c "
import json
try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
    import wave
    SetLogLevel(-1)
    wf = wave.open('${tmp}', 'rb')
    m = Model(lang='en-us')
    rec = KaldiRecognizer(m, wf.getframerate())
    while True:
        data = wf.readframes(4000)
        if len(data) == 0: break
        rec.AcceptWaveform(data)
    print(json.loads(rec.FinalResult()).get('text',''))
except: print('')
" 2>/dev/null`, { timeout: 30000 });
      return stdout.trim();
    } finally {
      await fs.remove(tmp).catch(() => {});
    }
  }

  // ── DETECT TTS ────────────────────────────────────────────────────────────
  async _detectTTS() {
    // Piper first — best quality
    if (this._piperBin && this._piperModel) return 'piper';

    // Festival second
    try {
      const { stdout } = await execAsync('which festival', { timeout: 3000 });
      if (stdout.trim()) return 'festival';
    } catch {}

    // espeak last resort
    try {
      const { stdout } = await execAsync('which espeak-ng || which espeak', { timeout: 3000 });
      if (stdout.trim()) return 'espeak';
    } catch {}

    return null;
  }

  // ── DETECT PIPER MODEL ────────────────────────────────────────────────────
  async _detectPiperModel() {
    const candidates = [
      // Male voices — priority order
      '/home/kali/.local/share/piper/en_US-ryan-high.onnx',
      path.join(process.env.HOME || '/home/kali', '.local/share/piper/en_US-ryan-high.onnx'),
      path.join(process.env.HOME || '/home/kali', '.local/share/piper/en_US-arctic-medium.onnx'),
      path.join(process.env.HOME || '/home/kali', '.local/share/piper/en_US-lessac-high.onnx'),
    ];

    for (const p of candidates) {
      if (await fs.pathExists(p)) return p;
    }

    // Scan piper dir for any model
    const home = process.env.HOME || '/home/kali';
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
    // Groq priority if key exists
    const apiKey = this.apiKeys.groq || process.env.GROQ_API_KEY;
    if (apiKey) return 'groq';

    const checks = [
      { name: 'whisper', cmd: 'which whisper' },
      { name: 'vosk',    cmd: 'python3 -c "import vosk" 2>/dev/null && echo ok' },
    ];
    for (const c of checks) {
      try {
        const { stdout } = await execAsync(c.cmd, { timeout: 3000 });
        if (stdout.trim()) return c.name;
      } catch {}
    }
    return null;
  }

  // ── CLEAN TEXT FOR SPEECH ─────────────────────────────────────────────────
  _cleanForSpeech(text, mode = 'normal') {
    let clean = text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`[^`]+`/g, match => match.replace(/`/g, ''))
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

  // ── TEJAS PHRASES ─────────────────────────────────────────────────────────
  _phrase(type) {
    const list = TEJAS_PHRASES[type] || ['Ready.'];
    return list[Math.floor(Math.random() * list.length)];
  }

  // Public phrase methods for commands/voice.js
  getActivationPhrase()          { return this._phrase('activation'); }
  getThinkingPhrase()            { return this._phrase('thinking'); }
  getCompletionPhrase(_, success){ return this._phrase(success ? 'done_success' : 'done_fail'); }
  getShutdownPhrase()            { return this._phrase('shutdown'); }
  getStartupPhrase()             { return this._phrase('startup'); }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  stop() { this.isListening = false; }
}

module.exports = VoiceEngine;
