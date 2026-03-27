import { existsSync } from 'fs';
import { resolve } from 'path';
import createLogger from '../logs/index.js';
import config from '../config/index.js';

const log = createLogger('verifier');

/**
 * Verifier — checks that tasks completed successfully.
 * Validates file existence, program execution, and goal completion.
 */
class Verifier {
  constructor() {
    this.llm = null;
    this.executor = null;
    this.memory = null;
  }

  init(core) {
    this.core = core;
    this.llm = core.get('llm');
    this.executor = core.get('executor');
    this.memory = core.get('memory');
    log.info('Verifier initialized');
  }

  /**
   * Verify that specific files exist
   */
  verifyFilesExist(files) {
    const results = [];
    for (const file of files) {
      const absPath = resolve(config.storage.projectsPath, file);
      const exists = existsSync(absPath);
      results.push({ file, exists, path: absPath });
      if (!exists) log.warn('File not found', { file, path: absPath });
    }
    const allExist = results.every(r => r.exists);
    return { success: allExist, results };
  }

  /**
   * Verify that a program/command runs without error
   */
  async verifyRuns(command, options = {}) {
    log.info('Verifying command runs', { command });
    this.core.setState('verifying');
    const result = await this.executor.runCommand(command, options);
    return { success: result.success, output: result.output, exitCode: result.exitCode };
  }

  /**
   * Use LLM to verify if a goal is complete based on task results
   */
  async verifyGoalComplete(goal, taskResults) {
    log.info('Verifying goal completion', { goal });
    this.core.setState('verifying');

    const prompt = `Goal: "${goal}"

Task results:
${taskResults.map((t, i) => `${i + 1}. ${t.description} — ${t.status === 'completed' ? '✓ Done' : '✗ Failed: ' + (t.error || 'unknown')}`).join('\n')}

Is the goal fully achieved? Respond with JSON:
{
  "complete": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "why you think so",
  "missingSteps": ["step1", "step2"] // empty if complete
}`;

    try {
      const result = await this.llm.askJSON(prompt, 'You are a task verifier. Assess whether a goal has been fully achieved based on task results.');
      log.info('Goal verification result', { complete: result.complete, confidence: result.confidence });
      return result;
    } catch (err) {
      log.error('Goal verification failed', { error: err.message });
      return { complete: false, confidence: 0, reasoning: 'Verification failed: ' + err.message, missingSteps: [] };
    }
  }

  /**
   * Run a comprehensive verification on a task
   */
  async verifyTask(task, result) {
    const checks = [];

    // If the task produced files, check they exist
    if (result.files && result.files.length) {
      const fileCheck = this.verifyFilesExist(result.files.map(f => f.path || f));
      checks.push({ type: 'files', ...fileCheck });
    }

    // If the task has a verify command, run it
    if (task.verifyCommand) {
      const runCheck = await this.verifyRuns(task.verifyCommand);
      checks.push({ type: 'run', ...runCheck });
    }

    const allPassed = checks.every(c => c.success);
    return { success: allPassed, checks };
  }

  async shutdown() {
    log.info('Verifier shutdown');
  }
}

export default Verifier;
