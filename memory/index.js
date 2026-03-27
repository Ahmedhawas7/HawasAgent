import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import config from '../config/index.js';
import createLogger from '../logs/index.js';

const log = createLogger('memory');

/**
 * Memory Engine — persistent vector + relational memory using SQLite.
 * Provides storage and retrieval for goals, tasks, errors, solutions,
 * projects, commands, knowledge, and history.
 */
class MemoryEngine {
  constructor() {
    this.db = null;
    this.dimensions = config.memory.vectorDimensions;
  }

  init(core) {
    this.core = core;
    const dbPath = config.storage.dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(config.memory.path, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
    log.info('Memory engine initialized', { dbPath });
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        embedding TEXT,
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        parent_id TEXT,
        result TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        result TEXT,
        error TEXT,
        retries INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (goal_id) REFERENCES goals(id)
      );

      CREATE TABLE IF NOT EXISTS errors (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        error_type TEXT,
        message TEXT NOT NULL,
        stack TEXT,
        solution TEXT,
        fixed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT,
        confidence REAL DEFAULT 0.5,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS command_history (
        id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        output TEXT,
        exit_code INTEGER,
        duration_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chat_history (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
      CREATE INDEX IF NOT EXISTS idx_errors_fixed ON errors(fixed);
    `);
  }

  // ─── Memory CRUD ──────────────────────────────────────────

  store(type, content, metadata = {}, tags = []) {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, type, content, metadata, tags)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, type, typeof content === 'string' ? content : JSON.stringify(content), JSON.stringify(metadata), JSON.stringify(tags));
    log.debug('Memory stored', { id, type });
    return id;
  }

  search(query, type = null, limit = 10) {
    const queryLower = query.toLowerCase();
    let sql = `SELECT * FROM memories WHERE LOWER(content) LIKE ?`;
    const params = [`%${queryLower}%`];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY access_count DESC, created_at DESC LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(sql).all(...params);
    // Bump access counts
    const bumpStmt = this.db.prepare(`UPDATE memories SET access_count = access_count + 1 WHERE id = ?`);
    for (const r of results) bumpStmt.run(r.id);
    return results.map(r => ({ ...r, metadata: JSON.parse(r.metadata), tags: JSON.parse(r.tags) }));
  }

  getByType(type, limit = 50) {
    return this.db.prepare(`SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ?`).all(type, limit)
      .map(r => ({ ...r, metadata: JSON.parse(r.metadata), tags: JSON.parse(r.tags) }));
  }

  // ─── Goals ────────────────────────────────────────────────

  storeGoal(text, priority = 5, parentId = null) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO goals (id, text, priority, parent_id) VALUES (?, ?, ?, ?)`).run(id, text, priority, parentId);
    this.store('goal', text, { goalId: id, priority });
    log.info('Goal stored', { id, text });
    return id;
  }

  updateGoal(id, updates) {
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(updates)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(id);
    this.db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getActiveGoals() {
    return this.db.prepare(`SELECT * FROM goals WHERE status IN ('pending', 'active') ORDER BY priority DESC`).all();
  }

  // ─── Tasks ────────────────────────────────────────────────

  storeTask(goalId, description, priority = 5) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO tasks (id, goal_id, description, priority) VALUES (?, ?, ?, ?)`).run(id, goalId, description, priority);
    log.debug('Task stored', { id, goalId });
    return id;
  }

  updateTask(id, updates) {
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(updates)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getPendingTasks(goalId = null) {
    if (goalId) {
      return this.db.prepare(`SELECT * FROM tasks WHERE goal_id = ? AND status = 'pending' ORDER BY priority DESC`).all(goalId);
    }
    return this.db.prepare(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC`).all();
  }

  getTasksByGoal(goalId) {
    return this.db.prepare(`SELECT * FROM tasks WHERE goal_id = ? ORDER BY priority DESC`).all(goalId);
  }

  // ─── Errors ───────────────────────────────────────────────

  storeError(taskId, message, errorType = 'runtime', stack = null) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO errors (id, task_id, error_type, message, stack) VALUES (?, ?, ?, ?, ?)`).run(id, taskId, errorType, message, stack);
    this.store('error', message, { taskId, errorType, errorId: id }, ['error']);
    return id;
  }

  findSimilarErrors(message) {
    return this.db.prepare(`SELECT * FROM errors WHERE LOWER(message) LIKE ? AND fixed = 1 ORDER BY created_at DESC LIMIT 5`).all(`%${message.toLowerCase().slice(0, 50)}%`);
  }

  markErrorFixed(id, solution) {
    this.db.prepare(`UPDATE errors SET fixed = 1, solution = ? WHERE id = ?`).run(solution, id);
  }

  // ─── Knowledge ────────────────────────────────────────────

  storeKnowledge(topic, content, source = null, confidence = 0.5) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO knowledge (id, topic, content, source, confidence) VALUES (?, ?, ?, ?, ?)`).run(id, topic, content, source, confidence);
    this.store('knowledge', content, { topic, source, confidence }, [topic]);
    return id;
  }

  searchKnowledge(query) {
    return this.db.prepare(`SELECT * FROM knowledge WHERE LOWER(topic) LIKE ? OR LOWER(content) LIKE ? ORDER BY confidence DESC LIMIT 10`).all(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`);
  }

  // ─── Command History ──────────────────────────────────────

  storeCommand(command, output, exitCode, durationMs) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO command_history (id, command, output, exit_code, duration_ms) VALUES (?, ?, ?, ?, ?)`).run(id, command, output || '', exitCode, durationMs);
    return id;
  }

  getRecentCommands(limit = 20) {
    return this.db.prepare(`SELECT * FROM command_history ORDER BY created_at DESC LIMIT ?`).all(limit);
  }

  // ─── Chat History ─────────────────────────────────────────

  storeChatMessage(chatId, role, text) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO chat_history (id, chat_id, role, text) VALUES (?, ?, ?, ?)`).run(id, String(chatId), role, text);
    return id;
  }

  getChatHistory(chatId, limit = 100) {
    return this.db.prepare(`SELECT * FROM chat_history WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`).all(String(chatId), limit).reverse();
  }

  // ─── Stats ────────────────────────────────────────────────

  getStats() {
    const memories = this.db.prepare(`SELECT COUNT(*) as count FROM memories`).get().count;
    const goals = this.db.prepare(`SELECT status, COUNT(*) as count FROM goals GROUP BY status`).all();
    const tasks = this.db.prepare(`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`).all();
    const errors = this.db.prepare(`SELECT fixed, COUNT(*) as count FROM errors GROUP BY fixed`).all();
    return { memories, goals, tasks, errors };
  }

  async shutdown() {
    if (this.db) this.db.close();
    log.info('Memory engine shutdown');
  }
}

export default MemoryEngine;
