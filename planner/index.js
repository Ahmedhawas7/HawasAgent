import createLogger from '../logs/index.js';

const log = createLogger('planner');

/**
 * Planner — uses LLM to analyze goals, decompose into tasks,
 * prioritize, and generate executable plans.
 */
class Planner {
  constructor() {
    this.llm = null;
    this.memory = null;
  }

  init(core) {
    this.core = core;
    this.llm = core.get('llm');
    this.memory = core.get('memory');
    log.info('Planner initialized');
  }

  /**
   * Generate a plan for a goal.
   * Returns: { tasks: [{ description, priority, type }], reasoning: string }
   */
  async plan(goal) {
    log.info('Planning for goal', { goal });
    this.core.setState('planning');

    // Get context from memory
    const relatedMemories = this.memory.search(goal, null, 5);
    const pastErrors = this.memory.search(goal, 'error', 3);
    const knowledge = this.memory.searchKnowledge(goal);

    const contextBlock = [
      relatedMemories.length ? `Related memories:\n${relatedMemories.map(m => `- [${m.type}] ${m.content}`).join('\n')}` : '',
      pastErrors.length ? `Past errors:\n${pastErrors.map(e => `- ${e.content}`).join('\n')}` : '',
      knowledge.length ? `Knowledge:\n${knowledge.map(k => `- ${k.topic}: ${k.content}`).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');

    const systemPrompt = `You are an AI agent planner. Your job is to take a goal and break it down into concrete, executable tasks.

Each task must be one of these types:
- "bash": run a shell command
- "code": write/create code or files
- "edit": modify existing code
- "analyze": read and analyze something
- "verify": check if something works

Rules:
- Be specific. Each task must be independently executable.
- Order tasks by dependency (do prerequisites first).
- Assign priority 1-10 (10 = highest).
- If you know about past errors related to this goal, avoid them.`;

    const prompt = `Goal: "${goal}"

${contextBlock ? `Context from memory:\n${contextBlock}\n\n` : ''}Break this goal into executable tasks. Respond with JSON:
{
  "reasoning": "your analysis of the goal",
  "tasks": [
    { "description": "what to do", "priority": 8, "type": "bash|code|edit|analyze|verify" }
  ]
}`;

    try {
      const result = await this.llm.askJSON(prompt, systemPrompt);
      const tasks = result.tasks || [];
      log.info('Plan generated', { taskCount: tasks.length });

      // Store plan in memory
      this.memory.store('plan', JSON.stringify({ goal, tasks, reasoning: result.reasoning }), { goal }, ['plan']);

      return { tasks, reasoning: result.reasoning || '' };
    } catch (err) {
      log.error('Planning failed', { error: err.message });
      // Fallback: create a single generic task
      return {
        tasks: [{ description: goal, priority: 5, type: 'analyze' }],
        reasoning: 'LLM planning failed, created single fallback task'
      };
    }
  }

  /**
   * Re-plan: update plan based on progress and errors
   */
  async replan(goal, completedTasks, failedTasks, errors) {
    log.info('Re-planning', { goal, completed: completedTasks.length, failed: failedTasks.length });

    const prompt = `Goal: "${goal}"

Completed tasks:
${completedTasks.map(t => `✓ ${t.description}`).join('\n') || 'None yet'}

Failed tasks:
${failedTasks.map(t => `✗ ${t.description} — Error: ${t.error || 'unknown'}`).join('\n') || 'None'}

Errors encountered:
${errors.map(e => `- ${e}`).join('\n') || 'None'}

Create updated tasks to complete the goal. Avoid repeating already-completed work. Fix or work around failures.
Respond with JSON:
{
  "reasoning": "your updated analysis",
  "tasks": [
    { "description": "what to do", "priority": 8, "type": "bash|code|edit|analyze|verify" }
  ]
}`;

    try {
      const result = await this.llm.askJSON(prompt, 'You are an AI agent re-planner. Generate revised tasks to reach the goal.');
      return { tasks: result.tasks || [], reasoning: result.reasoning || '' };
    } catch (err) {
      log.error('Re-planning failed', { error: err.message });
      return { tasks: [], reasoning: 'Re-planning failed: ' + err.message };
    }
  }

  async shutdown() {
    log.info('Planner shutdown');
  }
}

export default Planner;
