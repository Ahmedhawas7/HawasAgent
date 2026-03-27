import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import config from './config/index.js';
import { getCore } from './core/index.js';
import LLMClient from './core/llm.js';
import MemoryEngine from './memory/index.js';
import Planner from './planner/index.js';
import Executor from './executor/index.js';
import Builder from './builder/index.js';
import Fixer from './fixer/index.js';
import Verifier from './verifier/index.js';
import Agent from './agent/index.js';
import ToolRegistry from './tools/index.js';
import AutonomousLoop from './loop/index.js';
import CloudAdapter from './cloud/index.js';
import createLogger from './logs/index.js';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const log = createLogger('start-telegram');

// Global cleanup for Telegram promise errors
process.on('unhandledRejection', (reason) => {
    log.error('Caught unhandled rejection', { reason: reason.message || reason });
});

async function startTelegramBot() {
  log.info('╔══════════════════════════════════════╗');
  log.info('║   OpenClaw Agent — Telegram Mode     ║');
  log.info('╚══════════════════════════════════════╝');

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.error('TELEGRAM_BOT_TOKEN not set.');
    process.exit(1);
  }

  const projectsPath = resolve(process.cwd(), 'projects');
  mkdirSync(projectsPath, { recursive: true });

  const core = getCore();
  const llm = new LLMClient();
  core.register('llm', llm);
  const memory = new MemoryEngine();
  core.register('memory', memory);
  const executor = new Executor();
  core.register('executor', executor);
  const builder = new Builder();
  core.register('builder', builder);
  const planner = new Planner();
  core.register('planner', planner);
  const fixer = new Fixer();
  core.register('fixer', fixer);
  const verifier = new Verifier();
  core.register('verifier', verifier);
  const tools = new ToolRegistry();
  core.register('tools', tools);
  const agent = new Agent();
  core.register('agent', agent);
  const loop = new AutonomousLoop();
  core.register('loop', loop);
  const cloud = new CloudAdapter();
  core.register('cloud', cloud);

  const health = await llm.healthCheck();
  log.info(health.ok ? 'LLM connected' : 'LLM error');

  core.setState('idle');

  const bot = new TelegramBot(token, { polling: true });
  console.log(`\n🤖 OpenClaw Agent is ready!`);

  const safeSend = async (chatId, text) => {
      try {
          await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch (err) {
          log.warn('Markdown failed, using plain', { error: err.message });
          const plain = text.replace(/[*_`\[\]()]/g, '');
          await bot.sendMessage(chatId, plain).catch(e => log.error('Final send fail', e));
      }
  };

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    log.info(`[${chatId}] ${text}`);
    memory.storeChatMessage(chatId, 'user', text);

    if (text === '/start') {
      await safeSend(chatId, '🤖 يا هلا يا هندسة! أنا شريكك التقني.\nإبعت لي أي ملف عايز تبنيه وأنا معاك.');
      return;
    }

    try {
      const sendTyping = () => bot.sendChatAction(chatId, 'typing').catch(() => {});
      sendTyping();
      const interval = setInterval(sendTyping, 4000);

      const processResponse = await agent.process({ description: text, chatId });
      clearInterval(interval);
      
      let responseText = '';
      if (processResponse.decision) {
          const d = processResponse.decision;
          
          if (d.plan && Array.isArray(d.plan)) {
              responseText += `📝 *الخطة:* \n${d.plan.map((s, i) => `${i+1}. ${s}`).join('\n')}\n\n`;
          }

          if (d.tool === 'say' || !d.tool) {
              responseText += d.args?.message || d.args?.text || (typeof d === 'string' ? d : 'تمام يا هندسة، أنا عملت اللازم.');
          } else {
              responseText += `🤔 *Thinking:* ${d.explanation || 'Executing...'}\n🛠️ *Action:* ${d.tool}\n\n`;
              if (processResponse.result && processResponse.result.success) {
                  responseText += `✅ *Result:* \`${processResponse.result.output || 'Success'}\``;
              } else if (processResponse.result) {
                  responseText += `⚠️ *Error:* \`${processResponse.result.error || 'Failed'}\``;
              }
          }
      } else if (typeof processResponse === 'string') {
          responseText = processResponse;
      } else {
          responseText = '✅ تمام يا هندسة، الخطة اتنفذت بنجاح.';
      }

      await safeSend(chatId, responseText);

    } catch (err) {
      log.error(`Process Error: ${err.message}`);
      await bot.sendMessage(chatId, `⚠️ حصلت مشكلة: ${err.message}`).catch(() => {});
    }
  });
}

startTelegramBot().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
