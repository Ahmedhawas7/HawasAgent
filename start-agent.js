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
import { createInterface } from 'readline';

const log = createLogger('start-agent');

async function startAgent() {
  log.info('╔══════════════════════════════════════╗');
  log.info('║   OpenClaw Agent — Interactive Mode  ║');
  log.info('╚══════════════════════════════════════╝');
  log.info(`Mode: ${config.mode} | Model: ${config.llm.model}`);

  // Initialize core + all modules
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

  // Check LLM availability
  const health = await llm.healthCheck();
  if (health.ok) {
    log.info('LLM connected', { models: health.models });
  } else {
    log.warn('LLM not available — agent will use fallback behavior', { error: health.error });
    log.warn('Make sure Ollama is running: ollama serve');
  }

  core.setState('idle');

  // Interactive REPL
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🤖 OpenClaw Agent is ready!');
  console.log('Commands:');
  console.log('  goal <text>     — Set and run a goal autonomously');
  console.log('  task <text>     — Execute a single task');
  console.log('  status          — Show agent status');
  console.log('  memory <query>  — Search memory');
  console.log('  tools           — List available tools');
  console.log('  stop            — Stop current loop');
  console.log('  exit            — Shutdown agent');
  console.log('');

  const prompt = () => rl.question('agent> ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return prompt();

    const [cmd, ...rest] = trimmed.split(' ');
    const arg = rest.join(' ');

    try {
      switch (cmd.toLowerCase()) {
        case 'goal':
          if (!arg) { console.log('Usage: goal <text>'); break; }
          console.log(`\n🎯 Goal: ${arg}\n`);
          await loop.run(arg);
          console.log('\n✅ Goal processing complete.\n');
          break;

        case 'task':
          if (!arg) { console.log('Usage: task <text>'); break; }
          console.log(`\n⚡ Task: ${arg}\n`);
          const result = await agent.process({ description: arg, type: 'bash' });
          console.log('Result:', JSON.stringify(result, null, 2));
          break;

        case 'status':
          console.log(JSON.stringify(core.getStatus(), null, 2));
          break;

        case 'memory':
          if (!arg) { console.log(JSON.stringify(memory.getStats(), null, 2)); break; }
          const results = memory.search(arg);
          console.log(JSON.stringify(results, null, 2));
          break;

        case 'tools':
          console.log(tools.listTools().map(t => `  ${t.name}: ${t.description}`).join('\n'));
          break;

        case 'stop':
          loop.stop();
          console.log('Loop stopped.');
          break;

        case 'exit':
        case 'quit':
          console.log('Shutting down...');
          await core.shutdown();
          rl.close();
          process.exit(0);
          break;

        default:
          // Treat as a goal if it looks like a natural language command
          console.log(`\n🎯 Interpreting as goal: ${trimmed}\n`);
          await loop.run(trimmed);
          console.log('\n✅ Goal processing complete.\n');
      }
    } catch (err) {
      console.error('Error:', err.message);
    }

    prompt();
  });

  prompt();
}

startAgent().catch(err => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
