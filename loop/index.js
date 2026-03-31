import createLogger from '../logs/index.js';
import config from '../config/index.js';

const log = createLogger('loop');

/**
 * Autonomous Loop — the main control loop that drives the agent.
 * Cycle: plan → execute → verify → fix → store memory → continue
 */
class AutonomousLoop {
  constructor() {
    this.running = false;
    this.paused = false;
    this.currentGoal = null;
    this.iteration = 0;
    this.maxIterations = 100;
  }

  init(core) {
    this.core = core;
    this.planner = core.get('planner');
    this.agent = core.get('agent');
    this.executor = core.get('executor');
    this.builder = core.get('builder');
    this.fixer = core.get('fixer');
    this.verifier = core.get('verifier');
    this.memory = core.get('memory');
    this.llm = core.get('llm');
    log.info('Autonomous loop initialized');
  }

  /**
   * Run the full autonomous loop for a goal
   */
  async run(goalText, context = {}) {
    this.running = true;
    this.iteration = 0;
    this.currentGoal = goalText;
    this.context = context;

    log.info('=== AUTONOMOUS LOOP STARTED ===', { goal: goalText, context });
    this.core.emit('loopStart', { goal: goalText, context });

    // Store goal in memory
    const goalId = this.memory.storeGoal(goalText);
    this.memory.updateGoal(goalId, { status: 'active' });
    this.core.setGoal(goalText);

    try {
      // 1. PLAN
      log.info('Phase: PLANNING');
      const plan = await this.planner.plan(goalText);
      log.info('Plan created', { taskCount: plan.tasks.length, reasoning: plan.reasoning });

      // Store tasks in memory
      const taskIds = plan.tasks.map(t => this.memory.storeTask(goalId, t.description, t.priority));

      const completedTasks = [];
      const failedTasks = [];
      const errors = [];

      // 2. EXECUTE each task
      for (let i = 0; i < plan.tasks.length && this.running; i++) {
        if (this.paused) {
          log.info('Loop paused, waiting...');
          await this._waitWhilePaused();
        }

        this.iteration++;
        const task = { ...plan.tasks[i], id: taskIds[i] };
        log.info(`\n--- Task ${i + 1}/${plan.tasks.length}: ${task.description} ---`);
        this.core.emit('taskStart', { task, index: i, context: this.context });
        this.memory.updateTask(task.id, { status: 'active' });

        try {
          let result;

          if (task.type === 'code' || task.type === 'edit') {
            // Use builder for code tasks
            result = await this.builder.buildTask(task);
            if (result.commands && result.commands.length) {
              for (const cmd of result.commands) {
                await this.executor.runCommand(cmd);
              }
            }
          } else {
            // Use agent brain for thinking + tool execution
            const agentResult = await this.agent.process(task);
            result = agentResult.result;
          }

          if (result.success) {
            this.memory.updateTask(task.id, { status: 'completed', result: (result.output || '').slice(0, 2000), completed_at: new Date().toISOString() });
            completedTasks.push({ ...task, status: 'completed' });
            this.core.stats.tasksCompleted++;
            log.info(`✓ Task completed: ${task.description}`);
          } else {
            throw new Error(result.error || result.output || 'Task failed');
          }
        } catch (err) {
          log.error(`✗ Task failed: ${task.description}`, { error: err.message });
          errors.push(err.message);

          // 3. FIX
          const fixResult = await this.fixer.fix(task, err.message);
          if (fixResult.success) {
            this.memory.updateTask(task.id, { status: 'completed', result: 'Fixed: ' + (fixResult.output || ''), completed_at: new Date().toISOString() });
            completedTasks.push({ ...task, status: 'completed' });
            log.info(`✓ Task fixed and completed: ${task.description}`);
          } else {
            this.memory.updateTask(task.id, { status: 'failed', error: err.message, retries: 1 });
            failedTasks.push({ ...task, status: 'failed', error: err.message });
            this.core.stats.tasksFailed++;
            log.warn(`✗ Task permanently failed: ${task.description}`);
          }
        }

        this.core.emit('taskEnd', { task, index: i, context: this.context });

        // Small delay between tasks
        await this._delay(config.agent.loopDelayMs || 1000);
      }

      // 4. VERIFY goal completion
      log.info('Phase: VERIFICATION');
      const allTasks = [...completedTasks, ...failedTasks];
      const verification = await this.verifier.verifyGoalComplete(goalText, allTasks);

      if (verification.complete && verification.confidence >= 0.7) {
        this.memory.updateGoal(goalId, { status: 'completed', result: verification.reasoning, completed_at: new Date().toISOString() });
        log.info('=== GOAL COMPLETED ===', { confidence: verification.confidence });
        this.core.emit('goalComplete', { goalId, verification, context: this.context });
      } else if (failedTasks.length > 0 && this.iteration < this.maxIterations) {
        // Re-plan and retry failed parts
        log.info('Goal not fully complete, re-planning...');
        const replan = await this.planner.replan(goalText, completedTasks, failedTasks, errors);
        if (replan.tasks.length > 0) {
          log.info(`Re-planning produced ${replan.tasks.length} new tasks`);
          // Recursive call for remaining tasks (capped by maxIterations)
          // For now, store the re-plan for manual review
          this.memory.store('replan', JSON.stringify(replan), { goalId }, ['replan']);
        }
        this.memory.updateGoal(goalId, { status: 'partial', result: verification.reasoning });
      } else {
        this.memory.updateGoal(goalId, { status: 'partial', result: verification.reasoning });
        log.warn('Goal partially completed');
      }

      // 5. STORE summary in memory
      this.memory.store('loop_summary', JSON.stringify({
        goal: goalText,
        totalTasks: allTasks.length,
        completed: completedTasks.length,
        failed: failedTasks.length,
        verification
      }), { goalId }, ['summary']);

      return { goalId, completedTasks, failedTasks, verification };
    } catch (err) {
      log.fatal('Autonomous loop crashed', { error: err.message, stack: err.stack });
      this.memory.updateGoal(goalId, { status: 'failed', result: err.message });
      throw err;
    } finally {
      this.running = false;
      this.core.setState('idle');
      this.core.emit('loopEnd', { goal: goalText });
    }
  }

  /**
   * Stop the loop gracefully
   */
  stop() {
    this.running = false;
    log.info('Loop stop requested');
  }

  pause() {
    this.paused = true;
    log.info('Loop paused');
  }

  resume() {
    this.paused = false;
    log.info('Loop resumed');
  }

  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      currentGoal: this.currentGoal,
      iteration: this.iteration
    };
  }

  async _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _waitWhilePaused() {
    while (this.paused && this.running) {
      await this._delay(1000);
    }
  }

  async shutdown() {
    this.stop();
    log.info('Loop shutdown');
  }
}

export default AutonomousLoop;
