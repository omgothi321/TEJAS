# 🏗️ TEJAS Architecture

This document explains the internal design and data flow of the Tejas AI Operating System.

---

## 층 System Layers

### 1. **Interaction Layer**
How the user talks to Tejas:
- **CLI**: Standard terminal interface (`bin/tejas.js`).
- **Telegram Bot**: Remote control via `src/integrations/telegram.js`.
- **Voice**: Wake-word detection and TTS/STT in `src/voice/` and `src/tts/`.

### 2. **Brain Layer (`src/core/ai.js`)**
The orchestration engine:
- **Intent Parsing**: Uses LLMs to understand what the user wants.
- **Model Routing**: Selects the best model (Claude, Groq, etc.) based on cost, speed, and reasoning requirements.
- **Workflow Caching**: Speeds up repeated tasks by retrieving previously generated plans.

### 3. **Agent Layer (`src/agents/`)**
Specialized workers for specific domains:
- **Web Agent**: Browser automation and search.
- **File Agent**: Safe file system operations.
- **Code Agent**: Script generation and execution.
- **Workflow Agent**: Orchestrates multi-step complex tasks.

### 4. **Persistence Layer (`src/core/memory.js`)**
The "Long-term Memory":
- **Knowledge Graph**: Stores relationships between tasks, tools, and user preferences.
- **Pattern Recognition**: Learns from past successes to improve future execution.

---

## 🔄 Data Flow: `tejas run "task"`

1. **Input**: User sends a string.
2. **Analysis**: Brain Layer parses intent and checks Memory for similar past tasks.
3. **Planning**: AI generates a list of executable steps.
4. **Validation**: Sanitizer checks steps for security violations.
5. **Execution**: Executor passes steps to relevant Agents.
6. **Learning**: Success/Failure is logged back into the Knowledge Graph.

---

## 🛡️ Security Model

- **Process Isolation**: Tejas runs tasks in a controlled sub-shell.
- **Argument Injection Prevention**: Uses `execFile` with array-based arguments for sensitive integrations like Telegram.
- **Sanitizer Allowlist**: A strict list of safe shell operators and pipes.
- **Path Guard**: Normalizes and checks all file paths against the project root.
