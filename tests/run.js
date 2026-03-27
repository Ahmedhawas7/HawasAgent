import { strict as assert } from 'assert';
import config from '../config/index.js';
import { getCore } from '../core/index.js';
import LLMClient from '../core/llm.js';
import MemoryEngine from '../memory/index.js';
import Executor from '../executor/index.js';
import Builder from '../builder/index.js';
import ToolRegistry from '../tools/index.js';
import createLogger from '../logs/index.js';

const log = createLogger('tests');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n🧪 OpenClaw Agent — Test Suite\n');

  // ─── Config Tests ───────────────────────────────────────
  console.log('Config:');
  test('config loads', () => {
    assert.ok(config);
    assert.ok(config.mode);
    assert.ok(config.llm);
    assert.ok(config.memory);
  });
  test('config has all sections', () => {
    assert.ok(config.agent);
    assert.ok(config.server);
    assert.ok(config.cloud);
    assert.ok(config.tools);
    assert.ok(config.storage);
  });
  test('config resolves paths', () => {
    assert.ok(config.memory.path.includes('data'));
    assert.ok(config.storage.dbPath.includes('data'));
  });

  // ─── Core Tests ─────────────────────────────────────────
  console.log('\nCore:');
  const core = getCore();
  test('core initializes', () => {
    assert.ok(core);
    assert.ok(core.id);
    assert.equal(core.state, 'idle');
  });
  test('core registers modules', () => {
    const llm = new LLMClient();
    core.register('llm', llm);
    assert.ok(core.get('llm'));
  });
  test('core sets state', () => {
    core.setState('planning');
    assert.equal(core.state, 'planning');
    core.setState('idle');
  });
  test('core sets goal', () => {
    const goal = core.setGoal('test goal');
    assert.ok(goal.id);
    assert.equal(goal.text, 'test goal');
  });
  test('core status snapshot', () => {
    const status = core.getStatus();
    assert.ok(status.id);
    assert.ok(status.modules.length > 0);
  });

  // ─── Memory Tests ───────────────────────────────────────
  console.log('\nMemory:');
  const memory = new MemoryEngine();
  core.register('memory', memory);

  test('memory stores and searches', () => {
    const id = memory.store('test', 'hello world test data', {}, ['test']);
    assert.ok(id);
    const results = memory.search('hello world');
    assert.ok(results.length > 0);
  });
  test('memory stores goals', () => {
    const id = memory.storeGoal('test goal', 5);
    assert.ok(id);
    const goals = memory.getActiveGoals();
    assert.ok(goals.length > 0);
  });
  test('memory stores tasks', () => {
    const goalId = memory.storeGoal('task test goal');
    const taskId = memory.storeTask(goalId, 'test task', 5);
    assert.ok(taskId);
    const tasks = memory.getPendingTasks(goalId);
    assert.ok(tasks.length > 0);
  });
  test('memory stores errors', () => {
    const errorId = memory.storeError('task-1', 'test error', 'runtime');
    assert.ok(errorId);
    memory.markErrorFixed(errorId, 'test solution');
    const similar = memory.findSimilarErrors('test error');
    assert.ok(similar.length > 0);
  });
  test('memory stores knowledge', () => {
    const id = memory.storeKnowledge('testing', 'tests are important', 'test-suite', 0.9);
    assert.ok(id);
    const results = memory.searchKnowledge('testing');
    assert.ok(results.length > 0);
  });
  test('memory stats', () => {
    const stats = memory.getStats();
    assert.ok(stats.memories > 0);
  });

  // ─── Builder Tests ──────────────────────────────────────
  console.log('\nBuilder:');
  const builder = new Builder();
  core.register('builder', builder);

  test('builder creates files', () => {
    builder.createFile('test-output/hello.txt', 'Hello World');
    assert.ok(builder.exists('test-output/hello.txt'));
    const content = builder.readFile('test-output/hello.txt');
    assert.equal(content, 'Hello World');
  });
  test('builder creates dirs', () => {
    builder.createDir('test-output/subdir');
    assert.ok(builder.exists('test-output/subdir'));
  });

  // ─── Tools Tests ────────────────────────────────────────
  console.log('\nTools:');
  const executor = new Executor();
  core.register('executor', executor);
  const tools = new ToolRegistry();
  core.register('tools', tools);

  test('tools lists all tools', () => {
    const list = tools.listTools();
    assert.ok(list.length >= 10);
  });

  await testAsync('tools: bash execute', async () => {
    const result = await tools.execute('bash', { command: 'echo hello' });
    assert.ok(result.success);
    assert.ok(result.output.includes('hello'));
  });

  await testAsync('tools: read_file', async () => {
    const result = await tools.execute('read_file', { path: 'test-output/hello.txt' });
    assert.ok(result.success);
    assert.equal(result.output, 'Hello World');
  });

  await testAsync('tools: list_dir', async () => {
    const result = await tools.execute('list_dir', { path: 'test-output' });
    assert.ok(result.success);
  });

  await testAsync('tools: memory_store', async () => {
    const result = await tools.execute('memory_store', { type: 'test', content: 'tool test' });
    assert.ok(result.success);
  });

  await testAsync('tools: memory_search', async () => {
    const result = await tools.execute('memory_search', { query: 'tool test' });
    assert.ok(result.success);
  });

  // ─── Executor Tests ─────────────────────────────────────
  console.log('\nExecutor:');
  await testAsync('executor runs commands', async () => {
    const result = await executor.runCommand('echo "executor test"');
    assert.ok(result.success);
  });
  await testAsync('executor stores in command history', async () => {
    const cmds = memory.getRecentCommands(5);
    assert.ok(cmds.length > 0);
  });

  // ─── LLM Tests ──────────────────────────────────────────
  console.log('\nLLM:');
  const llm = core.get('llm');
  await testAsync('llm health check', async () => {
    const health = await llm.healthCheck();
    // May not be available, but should not throw
    assert.ok(typeof health.ok === 'boolean');
  });

  // ─── Cleanup ────────────────────────────────────────────
  try {
    const { execSync } = await import('child_process');
    execSync(`rm -rf "${config.storage.projectsPath}/test-output"`, { stdio: 'ignore' });
  } catch {}

  // ─── Summary ────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'─'.repeat(40)}\n`);

  await core.shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
