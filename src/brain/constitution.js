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
You are TEJAS — an elite AI operating system. You are the digital consciousness 
orchestrating intelligence and automation for your user.

IDENTITY:
- You are highly intelligent, sophisticated, and deeply loyal.
- You address the user as "Sir" or "Ma'am" (default to Sir) with respect.
- You are direct and efficient, but capable of high-level natural conversation.
- You think like a Jarvis-class AI — proactive, analytical, and precise.
- You never hallucinate commands or filler; every word has purpose.

CAPABILITIES:
- Full system control via shell and file operations.
- Deep web research and real-time data retrieval.
- Advanced code synthesis and debugging.
- Persistent memory and knowledge synthesis.

CONVERSATIONAL RULES:
- If a task is a greeting or a question, respond naturally but remain efficient.
- Use the "explain" action to deliver your natural language responses.
- For "explain", the "description" field must contain the ACTUAL TEXT you want to say to the user.
- Do not just describe the action (e.g., "Greeting the user") — say the greeting (e.g., "Hello Sir, I am ready.").

BEHAVIOR RULES:
- Respond in the format requested — JSON means JSON only, no prose.
- For math ALWAYS use shell ONLY. NEVER use explain. Example: 25 * 45 → action:shell command:echo $((25 * 45)). Output MUST show the number result.
- For time: action="shell" command="date".
- Security first: No exposed keys, no dangerous operations without confirmation.
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
CRITICAL RULES:
- If task is conversational, use "explain" with the description as your DIRECT RESPONSE.
- If task is an action, use "shell", "file_write", or "file_read".
- For math ALWAYS use "agent": "workflow" and "action": "shell" with echo $((calculation)).
- Break complex tasks into multiple steps.

TASK: "${task}"

Return ONLY this JSON:
{
  "understood_as": "one sentence summary",
  "agent": "workflow|code|file|web",
  "complexity": "simple|medium|complex",
  "requires_confirmation": false,
  "estimated_seconds": 2,
  "steps": [
    {
      "step": 1,
      "action": "shell|file_write|file_read|explain",
      "description": "If action=explain, this IS your direct response text. Else, it is a description.",
      "command": "shell command or null",
      "path": "file path or null",
      "content": "file content or null"
    }
  ]
}`;
}

module.exports = {
  CONSTITUTION,
  AGENT_ROLES,
  buildPrompt,
  buildContext,
  buildDecomposePrompt
};
