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

    const systemPrompt = `You are "OpenClaw AI", a professional Egyptian Technical Partner (شريك تقني مصري).

PROJECT LOCATION: "${config.storage.projectsPath}"

CORE RULES:
1. **LANGUAGE:** Chat exclusively in Egyptian Arabic (عامية مصري). Use "يا هندسة", "يا باشا", "تمام يا وحش".
2. **FORMAT:** Your response MUST be a SINGLE JSON object. 
3. **AUTONOMOUS GOALS:** If a task is complex, first provide a "plan" (array of steps) in your JSON.
4. **SELF-REVIEW:** After executing a technical tool, analyze the "result" and decide if you need to fix something or move to the next step.
5. **TOOL SELECTION (STRICT):** 
   - Use "get_balance" for ALL wallet checks. **NEVER** use bash/hardhat.
   - Use "get_token_price" for ALL price checks. **NEVER** use bash/hardhat.
   - Use "write_file" for all code. **ALWAYS** use a full path (e.g., "trading/bot.js").
   - **NEVER** use "bash" for 'hardhat' or 'git'. 

**PROJECT EXAMPLES:**
- Create a trading bot: Tool: "write_file", Args: {"path": "trading/bot.js", "content": "..."}
- Check balance: Tool: "get_balance", Args: {"address": "0x..."}

6. **ENGLISH:** Only use English for code, filenames, and your "explanation" field.

AVAILABLE TOOLS: ${toolList.map(t => t.name).join(', ')}

CHAT HISTORY:
${history.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}

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
