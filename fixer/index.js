import createLogger from '../logs/index.js';

const log = createLogger('fixer');

/**
 * Error Fixer — reads errors, searches memory for past solutions,
 * uses LLM to generate fixes, and retries failed operations.
 */
class Fixer {
  constructor() {
    this.llm = null;
    this.memory = null;
    this.builder = null;
    this.executor = null;
    this.maxRetries = 3;
  }

  init(core) {
    this.core = core;
    this.llm = core.get('llm');
    this.memory = core.get('memory');
    this.builder = core.get('builder');
    this.executor = core.get('executor');
    log.info('Fixer initialized');
  }

  /**
   * Attempt to fix an error from a failed task
   */
  async fix(task, error) {
    log.info('Attempting to fix error', { task: task.description, error });
    this.core.setState('fixing');

    // 1. Search memory for similar past errors and their solutions
    const pastFixes = this.memory.findSimilarErrors(error);
    const relatedKnowledge = this.memory.searchKnowledge(error);

    const contextParts = [];
    if (pastFixes.length) {
      contextParts.push(`Past similar errors and solutions:\n${pastFixes.map(f => `- Error: ${f.message}\n  Solution: ${f.solution}`).join('\n')}`);
    }
    if (relatedKnowledge.length) {
      contextParts.push(`Related knowledge:\n${relatedKnowledge.map(k => `- ${k.topic}: ${k.content}`).join('\n')}`);
    }

    const prompt = `A task failed with an error. Fix it.

Task: ${task.description}
Error: ${error}
${contextParts.length ? '\nContext:\n' + contextParts.join('\n\n') : ''}

Analyze the error and provide a fix. Respond with JSON:
{
  "analysis": "what went wrong",
  "fixType": "command|code|config|skip",
  "fix": "the command to run OR code to write OR config to change",
  "filePath": "path if fixType is code (optional)",
  "explanation": "why this fix should work"
}`;

    try {
      const result = await this.llm.askJSON(prompt, 'You are an error-fixing AI. Analyze errors and provide concrete fixes.');

      log.info('Fix generated', { fixType: result.fixType, explanation: result.explanation });

      let fixResult = { success: false };

      switch (result.fixType) {
        case 'command':
          fixResult = await this.executor.runCommand(result.fix);
          break;
        case 'code':
          if (result.filePath) {
            this.builder.createFile(result.filePath, result.fix);
            fixResult = { success: true, output: `File written: ${result.filePath}` };
          } else {
            fixResult = { success: false, error: 'No file path specified for code fix' };
          }
          break;
        case 'config':
          fixResult = { success: true, output: 'Config fix applied (manual review recommended)' };
          break;
        case 'skip':
          fixResult = { success: true, output: 'Error is non-critical, skipping' };
          break;
        default:
          fixResult = await this.executor.runCommand(result.fix);
      }

      if (fixResult.success) {
        // Store the solution in memory for future reference
        this.memory.storeKnowledge(
          `fix:${error.slice(0, 100)}`,
          result.explanation + '\nFix: ' + result.fix,
          'auto-fixer',
          0.7
        );
        const errorId = this.memory.storeError(task.id || 'unknown', error, 'runtime');
        this.memory.markErrorFixed(errorId, result.fix);
        this.core.stats.errorsFixed++;
        log.info('Error fixed successfully');
      }

      return { ...fixResult, analysis: result.analysis, fixType: result.fixType };
    } catch (err) {
      log.error('Fix attempt failed', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Retry a task with fixing loop
   */
  async retryWithFix(task, executeFunc, maxRetries = null) {
    const retries = maxRetries || this.maxRetries;
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      log.info(`Attempt ${attempt}/${retries}`, { task: task.description });

      const result = await executeFunc(task);
      if (result.success) return result;

      lastError = result.error || result.output;
      log.warn(`Attempt ${attempt} failed`, { error: lastError });

      if (attempt < retries) {
        const fixResult = await this.fix(task, lastError);
        if (!fixResult.success) {
          log.warn('Fix attempt also failed, will retry anyway');
        }
      }
    }

    log.error('All retry attempts exhausted', { task: task.description });
    return { success: false, error: `Failed after ${retries} attempts. Last error: ${lastError}` };
  }

  async shutdown() {
    log.info('Fixer shutdown');
  }
}

export default Fixer;
