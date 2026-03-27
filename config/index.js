import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function loadConfig() {
  const defaultPath = resolve(__dirname, 'default.json');
  const overridePath = resolve(ROOT, 'config.json');
  const envOverridePath = process.env.AGENT_CONFIG;

  let config = JSON.parse(readFileSync(defaultPath, 'utf-8'));

  // Merge project-root config.json if exists
  if (existsSync(overridePath)) {
    const overrides = JSON.parse(readFileSync(overridePath, 'utf-8'));
    config = deepMerge(config, overrides);
  }

  // Merge env-specified config if exists
  if (envOverridePath && existsSync(envOverridePath)) {
    const envOverrides = JSON.parse(readFileSync(envOverridePath, 'utf-8'));
    config = deepMerge(config, envOverrides);
  }

  // Environment variable overrides
  if (process.env.AGENT_MODE) config.mode = process.env.AGENT_MODE;
  if (process.env.LLM_BASE_URL) config.llm.baseUrl = process.env.LLM_BASE_URL;
  if (process.env.LLM_MODEL) config.llm.model = process.env.LLM_MODEL;
  if (process.env.PORT) config.server.port = parseInt(process.env.PORT, 10);
  if (process.env.MEMORY_PATH) config.memory.path = process.env.MEMORY_PATH;
  if (process.env.DB_PATH) config.storage.dbPath = process.env.DB_PATH;

  // Resolve relative paths to absolute
  config.memory.path = resolve(ROOT, config.memory.path);
  config.storage.dbPath = resolve(ROOT, config.storage.dbPath);
  config.storage.logsPath = resolve(ROOT, config.storage.logsPath);
  config.storage.projectsPath = resolve(ROOT, config.storage.projectsPath);

  config._root = ROOT;
  return config;
}

const config = loadConfig();
export default config;
export { loadConfig, ROOT };
