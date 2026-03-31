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

  try {
    // 5. Start listening
    const port = config.server.port;
    const host = config.server.host;

    httpServer.listen(port, host, async () => {
      log.info('╔══════════════════════════════════════╗');
      log.info(`║   Server running on ${host}:${port}     ║`);
      log.info('╚══════════════════════════════════════╝');
      
      const health = await llm.healthCheck();
      log.info('LLM Startup Check:', health);
      
      core.setState('idle');
    });
  } catch (err) {
    log.error('HTTP Server Listen Error:', err);
  }

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

let botStatus = { active: false, error: null, startTime: null };

async function startTelegram(core) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.error('CRITICAL: TELEGRAM_BOT_TOKEN is missing! Bot will not start.');
    botStatus.error = 'Missing Token';
    return;
  }

  try {
    log.info('Starting Telegram bot...');
    const bot = new TelegramBot(token, { polling: true });
    
    const agent = core.get('agent');
    const memory = core.get('memory');

    bot.getMe().then(me => {
      log.info('Bot identity verified:', { username: me.username });
      botStatus.active = true;
      botStatus.username = me.username;
      botStatus.startTime = new Date().toISOString();
    }).catch(err => {
      log.error('Bot identity verification failed:', err);
      botStatus.error = err.message;
    });

  const safeSend = async (chatId, text) => {
      try {
          await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch (err) {
          log.warn('Markdown failed, using plain', { error: err.message });
          const plain = text.replace(/[*_`\[\]()]/g, '');
          await bot.sendMessage(chatId, plain).catch(e => log.error('Final send fail', e));
      }
  };

    // ─── Proactive Listeners ─────────────────────────────────
    core.on('loopStart', ({ goal, context }) => {
      if (context.chatId) {
        safeSend(context.chatId, `🚀 *بدأنا يا هندسة!* \nجاري العمل على هدفك: "${goal}"`);
      }
    });

    core.on('taskStart', ({ task, index, context }) => {
      if (context.chatId) {
        bot.sendChatAction(context.chatId, 'typing').catch(() => {});
        safeSend(context.chatId, `🛠️ *بقوم دلوقتي بالخطوة ${index + 1}:* \n${task.description}`);
      }
    });

    core.on('goalComplete', ({ verification, context }) => {
      if (context.chatId) {
        const repo = config.storage.projectsPath.split('/').pop();
        const host = process.env.SPACE_HOST || 'localhost:7860';
        const previewUrl = `https://${host}/projects/`;
        
        safeSend(context.chatId, `✅ *تمت المهمة بنجاح يا وحش!* 🥳\n\n${verification.reasoning}\n\n🔗 *تقدر تشوف شغلك هنا:* \n${previewUrl}`);
      }
    });

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
      const loop = core.get('loop');
      // Run the full autonomous loop
      loop.run(text, { chatId }).catch(err => {
        log.error('Loop execution failed', { error: err.message });
        bot.sendMessage(chatId, `⚠️ حصلت مشكلة أثناء التنفيذ: ${err.message}`).catch(() => {});
      });
    } catch (err) {
      log.error(`Telegram Message Error: ${err.message}`);
      await bot.sendMessage(chatId, `⚠️ حصلت مشكلة: ${err.message}`).catch(() => {});
    }
  });

    log.info('Telegram bot active!');
  } catch (err) {
    log.error('Telegram bot failed to start:', err);
    botStatus.error = err.message;
  }
}

startServer().then(async ({ core }) => {
  core.register('botStatus', { get: () => botStatus }); 
  await startTelegram(core);
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
