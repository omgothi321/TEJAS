# ⚡ TEJAS — AI + Robotics Operating System

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Stability: Stable](https://img.shields.io/badge/stability-stable-blue.svg)]()

> **The digital consciousness for your machine.**  
> A high-performance, local-first AI orchestrator that turns your Linux environment into a Jarvis-class command center.

---

## 🚀 Core Philosophy
Tejas is designed for the modern developer who wants the power of advanced AI (Groq, Gemini, Claude) without sacrificing privacy or local control. It learns your workflows, manages your files, and executes complex tasks via Voice, Telegram, or CLI.

## 🛠️ Key Features
- **🧠 Multi-Model Brain:** Intelligent routing between **Groq (Llama 3.3 70B)**, **Gemini 2.0**, and **xAI**.
- **🎙️ Voice Interface:** Fully integrated **Piper TTS** and **Groq Whisper** for seamless voice control.
- **📱 Telegram Integration:** Control your PC from anywhere in the world with a secure Telegram bot.
- **📁 Specialized Agents:**
  - **File Agent:** Intelligent file organization and manipulation.
  - **Code Agent:** Synthesizes and debugs high-quality code.
  - **Web Agent:** Real-time research with Tavily integration.
  - **Workflow Agent:** Complex shell operation management.
- **📈 Memory Graph:** A persistent knowledge graph that grows and compounds with every interaction.

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/omgothi321/tejas.git
cd tejas

# Install dependencies
npm install

# Initialize your environment
tejas init
```

## ⌨️ Quick Usage

### Execute Tasks
```bash
tejas run "organize my desktop"
tejas run "what is the status of my docker containers?"
```

### Voice Control
```bash
tejas voice --listen
```

### Check System Status
```bash
tejas status
```

---

## 🏗️ Architecture
Tejas uses a **Router-Agent-Executor** pattern:
1. **Brain:** Decomposes natural language into a structured execution plan.
2. **Router:** Selects the optimal agent based on task requirements.
3. **Executor:** Executes the plan with built-in security sanitization.

## 🤝 Contributing
Built with passion by **Om** in Mumbai, India.  
Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📜 License
MIT © 2026 [Om Gothi](https://github.com/omgothi321)
