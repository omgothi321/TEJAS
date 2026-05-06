# 📖 TEJAS API Documentation

Tejas is controlled primarily via the CLI and the Telegram bot. This document describes the available commands and their options.

---

## 🛠️ CLI Commands

### `tejas run [task]`
Executes a natural language task.
- **Example**: `tejas run "search for latest AI news and summarize them"`
- **Flow**: Brain → Intent Parser → Web Agent → AI Summarizer.

### `tejas status`
Displays the current system status, including OS info, AI configuration, and active agents.

### `tejas voice [options]`
Controls the voice interface.
- `--speak [text]`: Converts text to speech using Piper.
- `--listen`: Starts continuous listening mode for the wake word "Tejas".

### `tejas memory [options]`
Manages the long-term memory and knowledge graph.
- `--show`: Displays a summary of the current graph.
- `--clear`: Wipes the local memory (requires confirmation).

### `tejas config [options]`
Manages environment and application configuration.
- `--set key=value`: Updates a configuration setting (e.g., `api_keys.groq=sk-...`).
- `--list`: Lists current configuration (secrets redacted).

### `tejas learn [task]`
Teaches Tejas a new workflow or pattern manually.

### `tejas dashboard`
Starts the local web dashboard (Alpha).

---

## 📱 Telegram Bot Commands

| Command | Action |
| :--- | :--- |
| `/start` | Displays welcome message and available commands. |
| `/status` | Returns a system status report. |
| `/files` | Lists files in the current project directory. |
| `/memory` | Returns a summary of the knowledge graph. |
| `/speak [text]` | Plays audio on the local system. |
| `/run [task]` | Executes any natural language task remotely. |

---

## ⚙️ Environment Variables

Refer to [.env.example](../.env.example) for a complete list of supported environment variables.
- `TELEGRAM_BOT_TOKEN`: Your bot token from @BotFather.
- `TELEGRAM_AUTHORIZED_IDS`: Comma-separated list of Telegram user IDs allowed to control the system.
- `TEJAS_MODEL`: The default AI model to use.
