import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import createLogger from '../logs/index.js';
import config from '../config/index.js';

const log = createLogger('core');

/**
 * Core Engine — the central nervous system of the agent.
 * Manages lifecycle, module registration, event bus, and state.
 */
class Core extends EventEmitter {
  constructor() {
    super();
    this.id = randomUUID();
    this.modules = new Map();
    this.state = 'idle'; // idle | planning | executing | verifying | fixing | stopped
    this.currentGoal = null;
    this.currentPlan = null;
    this.stats = { tasksCompleted: 0, tasksFailed: 0, errorsFixed: 0, startedAt: null };
    log.info('Core engine initialized', { id: this.id });
  }

  /**
   * Register a module (planner, executor, memory, etc.)
   */
  register(name, moduleInstance) {
    this.modules.set(name, moduleInstance);
    log.info(`Module registered: ${name}`);
    if (moduleInstance.init) {
      moduleInstance.init(this);
    }
  }

  /**
   * Get a registered module by name
   */
  get(name) {
    const mod = this.modules.get(name);
    if (!mod) log.warn(`Module not found: ${name}`);
    return mod;
  }

  /**
   * Set agent state and emit event
   */
  setState(newState) {
    const prev = this.state;
    this.state = newState;
    this.emit('stateChange', { from: prev, to: newState });
    log.info(`State: ${prev} → ${newState}`);
  }

  /**
   * Set the current goal
   */
  setGoal(goal) {
    this.currentGoal = { id: randomUUID(), text: goal, createdAt: new Date().toISOString(), status: 'active' };
    this.emit('goalSet', this.currentGoal);
    log.info('Goal set', { goal: this.currentGoal.text });
    return this.currentGoal;
  }

  /**
   * Get full status snapshot
   */
  getStatus() {
    return {
      id: this.id,
      state: this.state,
      goal: this.currentGoal,
      plan: this.currentPlan,
      stats: this.stats,
      modules: [...this.modules.keys()],
      config: { mode: config.mode, model: config.llm.model }
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    log.info('Shutting down core engine...');
    this.setState('stopped');
    for (const [name, mod] of this.modules) {
      if (mod.shutdown) {
        try { await mod.shutdown(); } catch (e) { log.error(`Error shutting down ${name}`, { error: e.message }); }
      }
    }
    this.emit('shutdown');
    log.info('Core engine stopped.');
  }
}

// Singleton
let instance = null;
function getCore() {
  if (!instance) instance = new Core();
  return instance;
}

export { Core, getCore };
export default getCore;
