# ⚡ TEJAS — AI + Robotics Operating System
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version: 2.0.0](https://img.shields.io/badge/Version-2.0.0-blue.svg)]()

Tejas is a high-performance, model-agnostic AI agent framework designed for local system automation, robotics control, and remote management. It provides a bridge between Large Language Models (LLMs) and your local operating system.

---

## 🚀 Key Features

- **🧠 Multi-Model Brain**: Seamlessly switch between Groq (Llama 3), Claude, Gemini, xAI, and local models via Ollama.
- **📱 Remote Control**: Secure Telegram integration for controlling your system from anywhere.
- **🎙️ Voice Interface**: Built-in TTS (Piper) and voice command support.
- **📂 Smart File Agent**: Context-aware file operations with built-in security sanitization.
- **🛡️ Security First**: Hardened command execution (`execFile`), input validation, and secure credential management.
- **📊 Knowledge Graph**: Persistent memory layer that learns your workflows over time.

---

## 🛠️ Architecture

Tejas follows a modular architecture:
- **Core**: Intent classification (`intent.js`), task execution (`executor.js`), and AI orchestration (`ai.js`).
- **Memory**: A JSON-based knowledge graph that stores user preferences, project context, and learned patterns.
- **Agents**: Specialized sub-systems for Web Search, File Operations, and Code Execution.
- **Integrations**: Telegram Bot and Dashboard for interaction.

---

## 📦 Installation

### Prerequisites
- Node.js >= 18.0.0
- Linux (Debian/Ubuntu/Kali recommended)
- API Keys for your preferred models (Groq, Gemini, etc.)

### Quick Start
```bash
git clone https://github.com/omgothi321/TEJAS.git
cd TEJAS
bash install.sh
```

### Setup Credentials
1. `cp .env.example .env`
2. Fill in your API keys and `TELEGRAM_BOT_TOKEN`.
3. Add your Telegram User ID to `TELEGRAM_AUTHORIZED_IDS`.

---

## 🛡️ Security Policy

Tejas is designed with several security layers:
- **Command Sanitization**: Prevents destructive shell operators and command injection.
- **Path Protection**: Blocks path traversal attempts outside the project root.
- **Credential Safety**: Strictly uses environment variables; no secrets are ever hardcoded or stored in config files.
- **Hardened Remote**: The Telegram integration uses `execFile` to avoid shell interpolation.

---

## 📖 Usage

### CLI Commands
- `tejas status` — Check system and agent status.
- `tejas run "your task"` — Execute a natural language task.
- `tejas voice --speak "Hello"` — Output text to speech.
- `tejas memory --show` — View the current knowledge graph.

### Telegram Control
Message your bot:
- `/status` — Get system report.
- `/run [task]` — Execute a task remotely.
- `/speak [text]` — Trigger local voice output.

---

## ⚖️ License
This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing
Contributions are welcome! Please see the issue tracker for planned features and security audits.

**Built by Om — Mumbai, India**
