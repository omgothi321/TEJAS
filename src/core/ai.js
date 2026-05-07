'use strict';

const axios = require('axios');
const chalk = require('chalk');

// ─── AI ENGINE ────────────────────────────────────────────────────────────────
// Supports: Claude, DeepSeek, OpenAI, Ollama, Gemini, Groq, xAI
// Tejas is model-agnostic. The Brain Layer picks the right one per task.

class AIEngine {
  constructor(config = {}) {
    this.model   = config.model   || process.env.TEJAS_MODEL || 'groq';
    this.apiKeys = config.api_keys || {};
    this.verbose = config.verbose  || false;
  }

  // ── MAIN CALL ─────────────────────────────────────────────────────────────
  async call(prompt, systemPrompt = null, options = {}) {
    const model = options.model || this.model;
    if (this.verbose) console.log(chalk.gray(`\n  [AI] model: ${model}`));

    switch (model) {
      case 'claude':   return this._callClaude(prompt, systemPrompt, options);
      case 'deepseek': return this._callDeepSeek(prompt, systemPrompt, options);
      case 'openai':
      case 'gpt':      return this._callOpenAI(prompt, systemPrompt, options);
      case 'ollama':   return this._callOllama(prompt, systemPrompt, options);
      case 'gemini':   return this._callGemini(prompt, systemPrompt, options);
      case 'groq':     return this._callGroq(prompt, systemPrompt, options);
      case 'xai':
      case 'grok':     return this._callXAI(prompt, systemPrompt, options);
      default:
        throw new Error(`Unknown model: ${model}. Supported: claude, groq, gemini, xai, deepseek, openai, ollama`);
    }
  }

  // ── CLAUDE ────────────────────────────────────────────────────────────────
  async _callClaude(prompt, systemPrompt, options = {}) {
    const apiKey = this.apiKeys.claude || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Claude API key. Run: tejas config --set api_keys.claude=YOUR_KEY');
    const body = {
      model: 'claude-sonnet-4-5',
      max_tokens: options.max_tokens || 4096,
      messages: [{ role: 'user', content: prompt }]
    };
    if (systemPrompt) body.system = systemPrompt;
    const res = await axios.post('https://api.anthropic.com/v1/messages', body, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      timeout: 60000
    });
    return res.data.content[0].text;
  }

  // ── GROQ (primary free model — 300 tok/sec) ───────────────────────────────
  async _callGroq(prompt, systemPrompt, options = {}) {
    const apiKey = this.apiKeys.groq || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('No Groq API key. Get free key at console.groq.com → Run: tejas config --set api_keys.groq=YOUR_KEY');
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model:       options.groq_model || 'llama-3.3-70b-versatile',
      max_tokens:  options.max_tokens || 4096,
      temperature: options.temperature || 0.7,
      messages
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    return res.data.choices[0].message.content;
  }

  // ── xAI GROK (analysis + reasoning) ──────────────────────────────────────
  async _callXAI(prompt, systemPrompt, options = {}) {
    const apiKey = this.apiKeys.xai || process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('No xAI API key. Get $175 free at console.x.ai → Run: tejas config --set api_keys.xai=YOUR_KEY');
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const res = await axios.post('https://api.x.ai/v1/chat/completions', {
      model:       options.xai_model || 'grok-beta',
      max_tokens:  options.max_tokens || 4096,
      temperature: options.temperature || 0.7,
      messages
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    return res.data.choices[0].message.content;
  }

  // ── GEMINI (web/search tasks, huge context) ───────────────────────────────
  async _callGemini(prompt, systemPrompt, options = {}) {
    const apiKey = this.apiKeys.gemini || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('No Gemini API key. Get free key at aistudio.google.com → Run: tejas config --set api_keys.gemini=YOUR_KEY');
    const model   = options.gemini_model || 'gemini-1.5-flash';
    const url     = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const parts   = [];
    if (systemPrompt) parts.push({ text: systemPrompt + '\n\n' });
    parts.push({ text: prompt });
    const res = await axios.post(url, {
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: options.max_tokens || 4096, temperature: options.temperature || 0.7 }
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
    return res.data.candidates[0].content.parts[0].text;
  }

  // ── DEEPSEEK (code tasks) ─────────────────────────────────────────────────
  async _callDeepSeek(prompt, systemPrompt, options = {}) {
    const apiKey = this.apiKeys.deepseek || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('No DeepSeek API key. Run: tejas config --set api_keys.deepseek=YOUR_KEY');
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const res = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat', max_tokens: options.max_tokens || 4096, messages
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    return res.data.choices[0].message.content;
  }

  // ── OPENAI ────────────────────────────────────────────────────────────────
  async _callOpenAI(prompt, systemPrompt, options = {}) {
    const apiKey = this.apiKeys.openai || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No OpenAI API key. Run: tejas config --set api_keys.openai=YOUR_KEY');
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: options.openai_model || 'gpt-4o-mini', max_tokens: options.max_tokens || 4096, messages
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    return res.data.choices[0].message.content;
  }

  // ── OLLAMA (offline) ──────────────────────────────────────────────────────
  async _callOllama(prompt, systemPrompt, options = {}) {
    const baseUrl = this.apiKeys.ollama_url || process.env.OLLAMA_URL || 'http://localhost:11434';
    const model   = options.ollama_model || 'llama3';
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const res = await axios.post(`${baseUrl}/api/generate`, {
      model, prompt: fullPrompt, stream: false
    }, { timeout: 120000 });
    return res.data.response;
  }

  // ── DECOMPOSE TASK → STEPS (used by run.js) ───────────────────────────────
  async decomposeTask(task, context = '') {
    const system = 'You are Tejas, an AI operating system. Decompose tasks into precise executable steps.';
    const prompt = `${context ? 'Context:\n' + context + '\n\n' : ''}Task: "${task}"

Return ONLY valid JSON:
{
  "understood_as": "one sentence",
  "agent": "workflow|code|file|web",
  "complexity": "simple|medium|complex",
  "requires_confirmation": false,
  "estimated_time_seconds": 5,
  "steps": [
    {
      "step": 1,
      "action": "shell|file_read|file_write|api_call|explain",
      "description": "what this does",
      "command": "exact command or null",
      "path": "file path or null",
      "content": "file content or null",
      "expected_output": "what success looks like"
    }
  ],
  "memory_update": { "should_learn": true, "pattern_name": "snake_case_name" }
}`;
    const raw = await this.call(prompt, system);
    return this._parseJSON(raw);
  }

  // ── JSON PARSER ───────────────────────────────────────────────────────────
  _parseJSON(text) {
    if (!text) throw new Error('Empty AI response');
    try { return JSON.parse(text); } catch {}
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
    const obj = text.match(/\{[\s\S]*\}/);
    if (obj)   { try { return JSON.parse(obj[0]); } catch {} }
    throw new Error(`Could not parse AI response as JSON: ${text.slice(0, 200)}`);
  }
}

module.exports = AIEngine;
