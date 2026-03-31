import express from 'express';
import path from 'path';
import createLogger from '../logs/index.js';
import config from '../config/index.js';

const log = createLogger('api');

/**
 * API Server — REST endpoints for controlling the agent.
 */
function createAPI(core) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // ─── Static Files (Projects) ─────────────────────────────
  const projectsPath = path.resolve(config.storage.projectsPath);
  app.use('/projects', express.static(projectsPath));

  // ─── Health ───────────────────────────────────────────────
  app.get('/', (req, res) => {
    res.send(`
      <h1>OpenClaw Agent is Online</h1>
      <p>Check <a href="/health">/health</a> for details.</p>
      <h2>Your Projects:</h2>
      <p>View your projects at <code>/projects/[project-name]</code></p>
    `);
  });

  app.get('/health', (req, res) => {
    const botStatusModule = core.get('botStatus');
    const botStatus = botStatusModule ? botStatusModule.get() : null;
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      bot: botStatus,
      envKeys: Object.keys(process.env).filter(k => !k.includes('TOKEN') && !k.includes('KEY') && !k.includes('PWD') && !k.includes('SECRET'))
    });
  });

  // ─── Status ───────────────────────────────────────────────
  app.get('/status', (req, res) => {
    const status = core.getStatus();
    const loop = core.get('loop');
    const memory = core.get('memory');
    res.json({
      ...status,
      loop: loop ? loop.getStatus() : null,
      memoryStats: memory ? memory.getStats() : null
    });
  });

  // ─── Goal ─────────────────────────────────────────────────
  app.post('/goal', async (req, res) => {
    const { goal } = req.body;
    if (!goal) return res.status(400).json({ error: 'Goal is required' });

    log.info('Goal received via API', { goal });
    const loop = core.get('loop');
    if (!loop) return res.status(500).json({ error: 'Loop module not available' });

    // Run asynchronously
    res.json({ status: 'accepted', goal, message: 'Goal processing started' });

    try {
      await loop.run(goal);
    } catch (err) {
      log.error('Goal execution failed', { error: err.message });
    }
  });

  // ─── Task ─────────────────────────────────────────────────
  app.post('/task', async (req, res) => {
    const { task, type = 'bash' } = req.body;
    if (!task) return res.status(400).json({ error: 'Task is required' });

    log.info('Task received via API', { task, type });
    const agent = core.get('agent');
    if (!agent) return res.status(500).json({ error: 'Agent module not available' });

    try {
      const result = await agent.process({ description: task, type });
      res.json({ status: 'completed', result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Tool execution ───────────────────────────────────────
  app.post('/tool', async (req, res) => {
    const { name, args } = req.body;
    if (!name) return res.status(400).json({ error: 'Tool name is required' });

    log.info('Tool request via API', { name });
    const tools = core.get('tools');
    if (!tools) return res.status(500).json({ error: 'Tools module not available' });

    try {
      const result = await tools.execute(name, args || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Memory ───────────────────────────────────────────────
  app.get('/memory', (req, res) => {
    const { query, type, limit } = req.query;
    const memory = core.get('memory');
    if (!memory) return res.status(500).json({ error: 'Memory not available' });

    if (query) {
      const results = memory.search(query, type, parseInt(limit) || 10);
      return res.json({ results });
    }
    res.json(memory.getStats());
  });

  app.post('/memory', (req, res) => {
    const { type, content, metadata, tags } = req.body;
    if (!type || !content) return res.status(400).json({ error: 'Type and content are required' });

    const memory = core.get('memory');
    if (!memory) return res.status(500).json({ error: 'Memory not available' });

    const id = memory.store(type, content, metadata, tags);
    res.json({ id, status: 'stored' });
  });

  // ─── Goals management ─────────────────────────────────────
  app.get('/goals', (req, res) => {
    const memory = core.get('memory');
    if (!memory) return res.status(500).json({ error: 'Memory not available' });
    res.json(memory.getActiveGoals());
  });

  // ─── Loop control ─────────────────────────────────────────
  app.post('/loop/stop', (req, res) => {
    const loop = core.get('loop');
    if (loop) loop.stop();
    res.json({ status: 'stopped' });
  });

  app.post('/loop/pause', (req, res) => {
    const loop = core.get('loop');
    if (loop) loop.pause();
    res.json({ status: 'paused' });
  });

  app.post('/loop/resume', (req, res) => {
    const loop = core.get('loop');
    if (loop) loop.resume();
    res.json({ status: 'resumed' });
  });

  // ─── LLM health ───────────────────────────────────────────
  app.get('/llm/health', async (req, res) => {
    const llm = core.get('llm');
    if (!llm) return res.status(500).json({ error: 'LLM not available' });
    const health = await llm.healthCheck();
    res.json(health);
  });

  // ─── Tools listing ────────────────────────────────────────
  app.get('/tools', (req, res) => {
    const tools = core.get('tools');
    if (!tools) return res.status(500).json({ error: 'Tools not available' });
    res.json(tools.listTools());
  });

  // ─── Self-improvement ─────────────────────────────────────
  app.post('/improve', async (req, res) => {
    const { target } = req.body;
    const agent = core.get('agent');
    if (!agent) return res.status(500).json({ error: 'Agent not available' });

    res.json({ status: 'accepted', message: 'Self-improvement task queued' });
    try {
      const loop = core.get('loop');
      await loop.run(`Analyze and improve the agent system: ${target || 'general optimization'}`);
    } catch (err) {
      log.error('Self-improvement failed', { error: err.message });
    }
  });

  log.info('API routes registered');
  return app;
}

export default createAPI;
