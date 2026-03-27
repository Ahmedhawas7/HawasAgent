import { exec } from 'child_process';
import { promisify } from 'util';
import createLogger from '../logs/index.js';
import config from '../config/index.js';

const execAsync = promisify(exec);
const log = createLogger('executor');

class Executor {
  constructor() {
    this.timeout = 120000;
  }

  init(core) {
    this.core = core;
    this.memory = core.get('memory');
    log.info('Executor initialized');
  }

  async runCommand(command, options = {}) {
    const cwd = options.cwd || config.storage.projectsPath;
    let cmd = command;

    if (process.platform === 'win32') {
        cmd = `chcp 65001 > nul && ${command}`;
    }

    log.info('Executing command', { command: cmd });
    this.core.setState('executing');
    
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd,
        timeout: this.timeout,
        shell: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      this.core.setState('idle');
      return { success: true, output: (stdout || stderr).trim() };
    } catch (err) {
      this.core.setState('idle');
      log.error('Command failed', { error: err.message });
      return { success: false, output: err.message, error: err.message };
    }
  }

  async shutdown() {}
}

export default Executor;
