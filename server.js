import { createServer } from 'http';
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
import createAPI from './api/index.js';
import createWebSocket from './web/websocket.js';
import createLogger from './logs/index.js';
import TelegramBot from 'node-telegram-bot-api';

const log = createLogger('server');

async function startServer() {
  log.info('╔══════════════════════════════════════╗');
  log.info('║   OpenClaw Agent — Starting Up...    ║');
  log.info('╚══════════════════════════════════════╝');
  log.info(`Mode: ${config.mode} | Model: ${config.llm.model}`);

  // 1. Initialize core
  const core = getCore();

  // 2. Create and register all modules (order matters for dependencies)
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

  // 3. Create API + HTTP server
  const app = createAPI(core);
  const httpServer = createServer(app);

  // 4. WebSocket
  if (config.server.enableWebSocket) {
    createWebSocket(httpServer, core);
  }

  // 5. Start listening
  const port = config.server.port;
  const host = config.server.host;

  httpServer.listen(port, host, () => {
    log.info('╔══════════════════════════════════════╗');
    log.info(`║   Server running on ${host}:${port}     ║`);
    log.info('╚══════════════════════════════════════╝');
    log.info('Endpoints:');
    log.info('  POST /goal     — Submit a goal');
    log.info('  POST /task     — Execute a task');
    log.info('  GET  /status   — Agent status');
    log.info('  POST /tool     — Run a tool');
    log.info('  GET  /memory   — Query memory');
    log.info('  POST /memory   — Store memory');
    log.info('  GET  /health   — Health check');
    log.info('  GET  /tools    — List tools');
    log.info('  GET  /goals    — Active goals');
    log.info('  POST /improve  — Self-improve');
    log.info('  WS   ws://     — WebSocket');
    core.setState('idle');
  });

  // 6. Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    httpServer.close();
    await core.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { core, httpServer, app };
}

async function startTelegram(core) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  log.info('Starting Telegram bot...');
  const bot = new TelegramBot(token, { polling: true });
  
  const agent = core.get('agent');
  const memory = core.get('memory');

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

    log.info(`[Telegram] [${chatId}] ${text}`);
    memory.storeChatMessage(chatId, 'user', text);

    if (text === '/start') {
      await safeSend(chatId, '🤖 يا هلا يا هندسة! أنا شريكك التقني.\nإبعت لي أي ملف عايز تبنيه وأنا معاك.');
      return;
    }

    try {
      bot.sendChatAction(chatId, 'typing').catch(() => {});
      const processResponse = await agent.process({ description: text, chatId });
      
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
      log.error(`Telegram Process Error: ${err.message}`);
      await bot.sendMessage(chatId, `⚠️ حصلت مشكلة: ${err.message}`).catch(() => {});
    }
  });

  log.info('Telegram bot active!');
}

startServer().then(async ({ core }) => {
  await startTelegram(core);
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
