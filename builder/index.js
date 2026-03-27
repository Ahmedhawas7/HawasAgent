import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import createLogger from '../logs/index.js';
import config from '../config/index.js';

const log = createLogger('builder');

/**
 * Builder — creates files, folders, code, configs, scripts.
 * Uses LLM to generate code when needed.
 */
class Builder {
  constructor() {
    this.llm = null;
    this.memory = null;
  }

  init(core) {
    this.core = core;
    this.llm = core.get('llm');
    this.memory = core.get('memory');
    log.info('Builder initialized');
  }

  /**
   * Create a file with content
   */
  createFile(filePath, content) {
    const absPath = resolve(config.storage.projectsPath, filePath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf-8');
    log.info('File created', { path: absPath });
    this.memory.store('file_created', filePath, { path: absPath, size: content.length }, ['build']);
    return absPath;
  }

  /**
   * Create a directory
   */
  createDir(dirPath) {
    const absPath = resolve(config.storage.projectsPath, dirPath);
    mkdirSync(absPath, { recursive: true });
    log.info('Directory created', { path: absPath });
    return absPath;
  }

  /**
   * Read a file
   */
  readFile(filePath) {
    const absPath = resolve(config.storage.projectsPath, filePath);
    if (!existsSync(absPath)) {
      log.warn('File not found', { path: absPath });
      return null;
    }
    return readFileSync(absPath, 'utf-8');
  }

  /**
   * Check if file/dir exists
   */
  exists(path) {
    return existsSync(resolve(config.storage.projectsPath, path));
  }

  /**
   * Use LLM to generate code for a task
   */
  async generateCode(task, context = '') {
    log.info('Generating code', { task });

    const systemPrompt = `You are an expert code generator. Generate clean, production-ready code.
Rules:
- Output ONLY the code, no markdown fences, no explanation.
- Include necessary imports.
- Add brief comments for complex logic.
- Handle errors gracefully.`;

    const prompt = `Task: ${task}
${context ? `\nContext:\n${context}` : ''}

Generate the code:`;

    const code = await this.llm.ask(prompt, systemPrompt);
    // Strip markdown fences if present
    return code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  /**
   * Use LLM to edit existing code
   */
  async editCode(filePath, instruction) {
    const currentCode = this.readFile(filePath);
    if (!currentCode) throw new Error(`Cannot edit: file not found: ${filePath}`);

    const prompt = `Current code in ${filePath}:
\`\`\`
${currentCode}
\`\`\`

Instruction: ${instruction}

Output the COMPLETE updated file. Output ONLY the code, no markdown fences.`;

    const newCode = await this.llm.ask(prompt, 'You are a code editor. Apply the requested changes and output the complete updated file. Only output code, no markdown.');
    const cleaned = newCode.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    this.createFile(filePath, cleaned);
    this.memory.store('file_edited', filePath, { instruction, path: filePath }, ['edit']);
    return cleaned;
  }

  /**
   * Build a complete task using LLM
   */
  async buildTask(task) {
    log.info('Building task', { task: task.description });

    const prompt = `Task: ${task.description}

Tell me:
1. What files need to be created or modified?
2. What is the content of each file?

Respond with JSON:
{
  "files": [
    { "path": "relative/path.js", "content": "file content here", "action": "create|edit" }
  ],
  "commands": ["optional shell commands to run after"]
}`;

    try {
      const plan = await this.llm.askJSON(prompt, 'You are a code builder. Generate files and commands to complete the task.');
      const results = [];

      for (const file of (plan.files || [])) {
        if (file.action === 'edit' && this.exists(file.path)) {
          await this.editCode(file.path, `Replace with: ${file.content}`);
        } else {
          this.createFile(file.path, file.content);
        }
        results.push({ path: file.path, action: file.action || 'create' });
      }

      return { success: true, files: results, commands: plan.commands || [] };
    } catch (err) {
      log.error('Build task failed', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  async shutdown() {
    log.info('Builder shutdown');
  }
}

export default Builder;
