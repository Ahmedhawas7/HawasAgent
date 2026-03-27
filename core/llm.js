import 'dotenv/config';
import config from '../config/index.js';
import createLogger from '../logs/index.js';

const log = createLogger('llm');

class LLMClient {
  constructor() {
    this.baseUrl = config.llm.baseUrl;
    this.model = config.llm.model;
    this.fallbackModel = config.llm.fallbackModel;
    this.temperature = config.llm.temperature;
    this.maxTokens = config.llm.maxTokens;
    
    this.groqApiKey = process.env.GROQ_API_KEY;
    // HARDCODED FIX: Use llama-3.1-8b-instant explicitly
    this.groqModel = 'llama-3.1-8b-instant';
    this.useGroq = !!this.groqApiKey;
  }

  init(core) {
    this.core = core;
    log.info('LLM client initialized', { 
      provider: this.useGroq ? 'groq' : 'ollama',
      model: this.useGroq ? this.groqModel : this.model 
    });
  }

  async chat(messages, options = {}) {
    if (this.useGroq) {
      return this.chatGroq(messages, options);
    }

    const model = options.model || this.model;
    const payload = {
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature || this.temperature,
        num_predict: options.maxTokens || this.maxTokens
      }
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const data = await res.json();
      return data.message?.content || '';
    } catch (err) {
      if (model !== this.fallbackModel) return this.chat(messages, { ...options, model: this.fallbackModel });
      throw err;
    }
  }

  async chatGroq(messages, options = {}) {
    const model = this.groqModel;
    const payload = {
      model,
      messages,
      temperature: options.temperature || this.temperature,
      max_tokens: options.maxTokens || this.maxTokens
    };

    try {
      log.info('LLM request (Groq)', { model });
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return data.choices[0]?.message?.content || '';
    } catch (err) {
      log.error('Groq call failed', { error: err.message });
      throw err;
    }
  }

  async ask(prompt, systemPrompt = null) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return this.chat(messages);
  }

  async askJSON(prompt, systemPrompt = null) {
    const jsonSystem = (systemPrompt || '') + '\n\nYou MUST respond with valid JSON only.';
    const raw = await this.ask(prompt, jsonSystem);
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON found');
    return JSON.parse(match[0]);
  }

  async healthCheck() {
    if (this.useGroq) return { ok: true, provider: 'groq', model: this.groqModel };
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return { ok: res.ok, provider: 'ollama' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async shutdown() {}
}

export default LLMClient;
