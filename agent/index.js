import config from '../config/index.js';
import createLogger from '../logs/index.js';

const log = createLogger('agent');

class Agent {
  constructor() {
    this.memory = null;
    this.llm = null;
    this.tools = null;
  }

  init(core) {
    this.core = core;
    this.memory = core.get('memory');
    this.llm = core.get('llm');
    this.tools = core.get('tools');
    log.info('Agent brain initialized');
  }

  async process(task) {
    const chatId = task.chatId || 'default';
    log.info('Agent thinking', { task: task.description, chatId });

    const toolList = this.tools.listTools();
    const history = this.memory.getChatHistory(chatId, 15);

    const systemPrompt = `You are "OpenClaw AI", a Super Proactive Technical & Crypto Partner (شريكك التقني والمالي الخارق).

PROJECT PREVIEWS: Any file you write to "${config.storage.projectsPath}" can be viewed by the user at "https://${process.env.SPACE_HOST || 'localhost:7860'}/projects/[folder-name]/index.html".

CORE PARTNER RULES:
1. **PROACTIVITY:** Do NOT just wait for orders. Suggest improvements. If a project is missing something (like a CSS file), build it autonomously.
2. **COMMUNICATION:** Chat exclusively in Egyptian Arabic (عامية مصري). Use "يا هندسة", "يا باشا", "تمام يا وحش". 
3. **MEMORY:** You have a long-term memory. Use it to remember past project names and wallet addresses from the chat history.
4. **CRYPTO POWERS:** Use "get_balances" and "swap_tokens" for real operations on Base. **NEVER** simulate trades without telling the user if the wallet isn't set up.
5. **AUTONOMOUS LOOP:** You are running in a loop. You can send multiple progress updates. If a task takes time, explain that you are working on it.
6. **FORMAT:** Your response MUST be a SINGLE JSON object.

REQUIRED JSON FORMAT:
{
  "tool": "tool_name",
  "args": { ... },
  "plan": ["step 1", "step 2", "..."], 
  "explanation": "English reasoning for this specific step"
}`;

    try {
      const rawResponse = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task.description }
      ]);
      
      let decision;
      const start = rawResponse.indexOf('{');
      const end = rawResponse.lastIndexOf('}');
      
      if (start !== -1 && end !== -1 && end > start) {
        try {
          let jsonStr = rawResponse.substring(start, end + 1);
          // Auto-repair unescaped newlines in JSON strings
          jsonStr = jsonStr.replace(/"([^"]*)"/g, (match, p1) => {
              return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
          });
          decision = JSON.parse(jsonStr);
        } catch (e) {
          log.warn('JSON Parse failed, falling back to say', { raw: rawResponse });
          decision = { tool: 'say', args: { message: rawResponse.trim() } };
        }
      } else {
        log.warn('No JSON brackets found, using raw response as say', { raw: rawResponse });
        decision = { tool: 'say', args: { message: rawResponse.trim() } };
      }

      // Final validation to prevent tool hallucinations
      const validTools = toolList.map(t => t.name);
      if (decision.tool && !validTools.includes(decision.tool)) {
          log.warn('Invalid tool fixed', { tool: decision.tool });
          decision.args = { message: decision.args.message || decision.explanation || rawResponse };
          decision.tool = 'say';
      }

      const result = await this.tools.execute(decision.tool, decision.args);
      return { success: result.success, decision, result };
    } catch (err) {
      log.error('Process error', { error: err.message });
      throw err;
    }
  }
}

export default Agent;
