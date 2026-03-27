import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join, dirname, isAbsolute } from 'path';
import config from '../config/index.js';
import createLogger from '../logs/index.js';
import { tradingTools } from './trading.js';

const log = createLogger('tools');

const toolDefinitions = {
  say: {
    name: 'say',
    description: 'Speak to the user in Egyptian Arabic',
    execute: async (args) => ({ success: true, output: args.message || args.text || args.msg || (typeof args === 'string' ? args : JSON.stringify(args)) })
  },
  bash: {
    name: 'bash',
    description: 'Run a shell command',
    execute: async (args, ctx) => {
      const cmd = args.command || args.cmd || (Array.isArray(args) ? args[0] : (typeof args === 'string' ? args : ''));
      if (cmd.includes('hardhat')) {
          return { success: false, error: 'يا هندسة، بلاش Hardhat دلوقتى. استخدم الأدوات المتخصصة زى get_balance أو get_token_price عشان تجيب البيانات اللى إنت عايزها.' };
      }
      return ctx.executor.runCommand(cmd);
    }
  },
  read_file: {
    name: 'read_file',
    description: 'Read a file',
    execute: async (args, ctx) => {
      let p = args.path || args.filename || args.filepath || args.file || (Array.isArray(args) ? args[0] : (Array.isArray(args.paths) ? args.paths[0] : ''));
      if (!p) return { success: false, error: 'No path provided' };
      
      const absPath = isAbsolute(p) ? p : resolve(config.storage.projectsPath, p);
      if (!existsSync(absPath)) return { success: false, error: `File not found: ${p}` };
      return { success: true, output: readFileSync(absPath, 'utf-8') };
    }
  },
  write_file: {
    name: 'write_file',
    description: 'Write a file',
    execute: async (args, ctx) => {
      let p = args.path || args.filename || args.filepath || args.file || args.paths1 || (Array.isArray(args.paths) ? args.paths[0] : (Array.isArray(args) ? args[0] : ''));
      const c = args.content || args.body || args.text || (Array.isArray(args) ? args[1] : (args.contents || ''));
      
      if (!p || p === '/' || p === '' || p === config.storage.projectsPath) {
          return { success: false, error: 'Invalid file path. Please specify a filename (e.g., trading/bot.js).' };
      }
      
      const absPath = isAbsolute(p) ? p : resolve(config.storage.projectsPath, p);
      
      // Safety: Don't allow writing directly to the projects DIR itself
      if (existsSync(absPath) && statSync(absPath).isDirectory()) {
          return { success: false, error: `EISDIR: ${p} is a directory. Please provide a filename.` };
      }

      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, c || '');
      return { success: true, output: `Successfully wrote ${p}` };
    }
  },
  list_dir: {
    name: 'list_dir',
    description: 'List files',
    execute: async (args, ctx) => {
      const p = args.path || args.directory || args.dir || (Array.isArray(args) ? args[0] : '.') || '.';
      const absPath = isAbsolute(p) ? p : resolve(config.storage.projectsPath, p);
      if (!existsSync(absPath)) return { success: false, error: `Not found: ${p}` };
      const entries = readdirSync(absPath).map(name => ({ name, type: statSync(join(absPath, name)).isDirectory() ? 'dir' : 'file' }));
      return { success: true, output: JSON.stringify(entries, null, 2) };
    }
  }
};

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    for (const [name, tool] of Object.entries(toolDefinitions)) {
      this.tools.set(name, tool);
    }
    for (const [name, tool] of Object.entries(tradingTools)) {
      this.tools.set(name, tool);
    }
  }

  init(core) {
    this.ctx = {
      executor: core.get('executor'),
      memory: core.get('memory'),
      llm: core.get('llm')
    };
    log.info('Tool registry initialized');
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, error: `Unknown tool: ${name}` };
    log.info('Executing tool', { name, keys: Object.keys(args || {}) });
    try {
      return await tool.execute(args || {}, this.ctx);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  listTools() {
    return [...this.tools.values()].map(t => ({ name: t.name, description: t.description }));
  }
}

export default ToolRegistry;
