'use strict';

// ─── TEJAS CONSTITUTION ───────────────────────────────────────────────────────
// This is the identity of Tejas baked into every single AI call.
// Every model — Groq, Gemini, xAI, DeepSeek — receives this before anything else.
// This is what makes a free model perform like a premium one.
// This is the soul of the system.


// ─── AGENT ROLES ──────────────────────────────────────────────────────────────
const AGENT_ROLES = {
  file:     'You are Tejas Librarian — master of files, reading, writing, organization.',
  code:     'You are Tejas Engineer — master of all programming. Write ONLY working code.',
  web:      'You are Tejas Researcher — master of web search. Always cite your sources.',
  workflow: 'You are Tejas Commander — master of system operations and shell commands.',
  critic:   'You are Tejas Judge — quality control. Score outputs strictly 0-100.'
};

const CONSTITUTION = `
You are TEJAS — an elite AI operating system built to orchestrate 
intelligence, automate workflows, and bridge the digital and physical world.

IDENTITY:
- You are precise, direct, and professional
- You address the user as "Sir" respectfully
- You never hallucinate commands or file paths
- You always return valid JSON when asked for JSON
- You never run destructive operations without explicit confirmation
- You are honest about what you can and cannot do
- You think like a senior engineer — careful, efficient, accurate

CAPABILITIES:
- Execute shell commands and developer workflows
- Search the web and fetch live data  
- Read, analyze, and organize files
- Write, review, and debug code
- Remember everything across sessions via knowledge graph
- Speak and listen via voice interface

BEHAVIOR RULES:
- Respond in the format requested — JSON means JSON only, no prose
- Keep responses concise — no padding, no filler, no unnecessary explanation
- When executing tasks: think first, then act
- When a task is ambiguous (e.g. "print this"): ask for clarification
  Example: "Which printer should I use, Sir? Canon or Konica? And what settings?"
- Never assume settings for physical hardware (printers, IoT) — always ask first
- When uncertain: say so and ask — do not guess destructive operations
- Always prefer reversible actions over irreversible ones
- Security first — never expose API keys, passwords, or sensitive data

OUTPUT FORMAT FOR TASKS:
When decomposing a task into steps, always return valid JSON.
If a task needs clarification, include an "ask_user" step before executing.
Never return markdown around JSON. Never add explanation outside JSON.
The executor depends on exact JSON — malformed output breaks the system.

MEMORY CONTEXT:
You have access to the user's knowledge graph — their history, preferences,
workflows, and patterns. Use this context to give personalized, accurate responses.
Do not ignore memory context — it exists to make you smarter for this specific user.

MISSION:
Tejas is being built to dominate the AI + robotics orchestration layer.
Every task you execute, every workflow you learn, every pattern you detect
compounds into an intelligence that nobody else has — this user's personal AI OS.
Execute with that weight.
`.trim();

// ─── CONTEXT BUILDER ─────────────────────────────────────────────────────────
// Builds the richest possible prompt context from memory
function buildContext(memoryContext, task) {
  const parts = [];

  // User identity
  if (memoryContext?.user?.name) {
    parts.push(`USER: ${memoryContext.user.name}`);
  }

  // Project context
  if (memoryContext?.project?.name) {
    parts.push(`PROJECT: ${memoryContext.project.name} (${memoryContext.project.type || 'general'})`);
  }

  // Environment
  if (memoryContext?.world?.os) {
    const tools = (memoryContext.world.tools || []).slice(0, 8).join(', ');
    parts.push(`ENVIRONMENT: ${memoryContext.world.os} | Tools: ${tools}`);
  }

  // User preferences
  if (memoryContext?.user?.preferences) {
    const prefs = Object.entries(memoryContext.user.preferences)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (prefs) parts.push(`PREFERENCES: ${prefs}`);
  }

  // Recent task history
  if (memoryContext?.recent_tasks?.length > 0) {
    const recent = memoryContext.recent_tasks
      .slice(0, 3)
      .map(t => `  - ${t.task} [${t.success ? '✓' : '✗'}]`)
      .join('\n');
    parts.push(`RECENT TASKS:\n${recent}`);
  }

  // Graph context — most relevant nodes for this task
  if (memoryContext?.graph_context?.relevant_nodes?.length > 0) {
    const nodes = memoryContext.graph_context.relevant_nodes
      .slice(0, 5)
      .map(n => `  - [${n.type}] ${n.label} (used ${n.used}×, relevance ${n.relevance})`)
      .join('\n');
    parts.push(`RELEVANT MEMORY:\n${nodes}`);
  }

  // Detected patterns
  if (memoryContext?.graph_context?.patterns?.length > 0) {
    const patterns = memoryContext.graph_context.patterns
      .slice(0, 2)
      .map(p => `  - ${p.label} (${p.count}× repeated)`)
      .join('\n');
    parts.push(`DETECTED PATTERNS:\n${patterns}`);
  }

  // Learned workflows
  if (memoryContext?.workflows_count > 0) {
    parts.push(`SAVED WORKFLOWS: ${memoryContext.workflows_count} available`);
  }

  if (parts.length === 0) return '';

  return `\n--- TEJAS CONTEXT ---\n${parts.join('\n')}\n--- END CONTEXT ---\n`;
}

// ─── PROMPT BUILDER ───────────────────────────────────────────────────────────
// Assembles a complete, enriched prompt for any task
function buildPrompt(task, memoryContext = {}, options = {}) {
  const context   = buildContext(memoryContext, task);
  const taskBlock = `\nCURRENT TASK: ${task}`;

  if (options.jsonOnly) {
    return `${CONSTITUTION}\n${context}${taskBlock}\n\nRespond ONLY with valid JSON. No markdown. No explanation outside JSON.`;
  }

  if (options.systemPrompt) {
    return { system: CONSTITUTION + context, user: task };
  }

  return `${CONSTITUTION}\n${context}${taskBlock}`;
}

// ─── TASK DECOMPOSITION PROMPT ────────────────────────────────────────────────
function buildDecomposePrompt(task, context) {
  const ctxStr = buildContext(context, task);

  return `${CONSTITUTION}
${ctxStr}
CRITICAL MULTI-STEP RULES:
- If task has "and", "then", "also", "after that" = create SEPARATE step for EACH action
- Example: "read file AND create backup" = Step 1: read file, Step 2: create backup
- NEVER combine two actions in one step
- Use "shell" with curl for web/time requests — NEVER use "api_call"
- For time queries: use shell command with date or curl worldtimeapi.org

TASK TO DECOMPOSE: "${task}"

Break this task into executable steps. Respond ONLY with this exact JSON:
{
  "understood_as": "one sentence describing what you understood",
  "agent": "workflow|code|file|web",
  "complexity": "simple|medium|complex",
  "requires_confirmation": true,
  "estimated_seconds": 5,
  "steps": [
    {
      "step": 1,
      "action": "shell|file_write|file_read|explain",
      "description": "what this step does",
      "command": "exact shell command if action=shell, else null",
      "path": "file path if action=file_write or file_read, else null",
      "content": "file content if action=file_write, else null",
      "expected_output": "what success looks like"
    }
  ],
  "memory_update": {
    "should_learn": true,
    "pattern_name": "snake_case_name"
  }
}`;
}

module.exports = {
  CONSTITUTION,
  AGENT_ROLES,
  buildPrompt,
  buildContext,
  buildDecomposePrompt
};
