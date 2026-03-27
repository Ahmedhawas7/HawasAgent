import createLogger from '../logs/index.js';
import config from '../config/index.js';

const log = createLogger('cloud');

/**
 * Cloud Module — Provides cloud-readiness abstractions.
 * When cloud mode is enabled, this module can redirect:
 * - LLM calls to remote endpoints
 * - DB connections to remote databases
 * - Storage to cloud filesystems
 */
class CloudAdapter {
  constructor() {
    this.enabled = config.cloud.enabled;
  }

  init(core) {
    this.core = core;
    if (this.enabled) {
      log.info('Cloud mode ENABLED', { provider: config.cloud.provider, region: config.cloud.region });
      this._applyCloudOverrides();
    } else {
      log.info('Cloud mode disabled (local mode)');
    }
  }

  _applyCloudOverrides() {
    // Override LLM base URL if remote LLM is configured
    if (config.cloud.remoteLlmUrl) {
      config.llm.baseUrl = config.cloud.remoteLlmUrl;
      log.info('LLM redirected to cloud', { url: config.cloud.remoteLlmUrl });
    }

    // Override DB path if remote DB is configured
    if (config.cloud.remoteDbUrl) {
      log.info('Remote DB configured', { url: config.cloud.remoteDbUrl });
      // In a full implementation, this would swap the SQLite adapter for a
      // PostgreSQL/MySQL client. For now, we log the intent.
    }
  }

  /**
   * Get cloud deployment info (for Docker/K8s readiness probes)
   */
  getInfo() {
    return {
      enabled: this.enabled,
      provider: config.cloud.provider,
      region: config.cloud.region,
      mode: config.mode
    };
  }

  async shutdown() {
    log.info('Cloud adapter shutdown');
  }
}

export default CloudAdapter;
