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

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
