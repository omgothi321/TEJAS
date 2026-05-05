'use strict';

/**
 * Tejas Smart Intent System (Brain Layer v2.0)
 * Uses AI to perform zero-shot intent classification and entity extraction.
 */

class IntentParser {
  constructor(aiEngine) {
    this.ai = aiEngine;
  }

  async parse(task) {
    const prompt = `
You are the Tejas Hyper-Intent Parser.
Use Chain-of-Thought (Thought -> Action -> Observation) reasoning to break down the user's input.

User Task: "${task}"

1. THOUGHT: What is the user's deep intent? Are they asking for multiple things at once?
2. ACTION: Which agent(s) (web.search, file.operation, code.task, robotics.control, or general) are BEST suited for this?
3. OBSERVATION: What entities (filenames, quantities, locations, tools) are mentioned?

Respond ONLY with valid JSON:
{
  "thought": "your chain-of-thought process",
  "intent": "primary_intent (e.g., code.task)",
  "sub_intents": ["list of potential sub-intents"],
  "confidence": 0.0 to 1.0,
  "entities": {
    "action": "string",
    "target": "string",
    "params": {}
  },
  "reasoning": "short explanation for routing"
}`;

    try {
      const response = await this.ai.call(prompt, "You are the Tejas Intent Parser. Your job is to extract structured meaning from natural language.");
      const parsed = this.ai._parseJSON(response);
      return parsed;
    } catch (err) {
      // Fallback to basic logic if AI fails
      return this._fallback(task);
    }
  }

  _fallback(task) {
    const lower = task.toLowerCase();
    let intent = 'general';
    if (/(search|find online|news|look up)/.test(lower)) intent = 'web.search';
    else if (/(file|create file|write to|save)/.test(lower)) intent = 'file.operation';

    return {
      thought: "Fallback triggered — basic keyword matching.",
      intent,
      sub_intents: [],
      confidence: 0.5,
      entities: { },
      reasoning: "AI engine failed to respond or parse correctly."
    };
  }
}

module.exports = IntentParser;
