import { WebSocketServer } from 'ws';
import createLogger from '../logs/index.js';

const log = createLogger('websocket');

/**
 * WebSocket Server — real-time event streaming for remote control and web UI.
 */
function createWebSocket(server, core) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    log.info('WebSocket client connected', { total: clients.size });

    // Send current status on connect
    ws.send(JSON.stringify({ type: 'status', data: core.getStatus() }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        log.debug('WS message received', { type: msg.type });

        switch (msg.type) {
          case 'goal':
            broadcast({ type: 'goal_accepted', data: { goal: msg.goal } });
            const loop = core.get('loop');
            if (loop) loop.run(msg.goal).catch(err => log.error('WS goal failed', { error: err.message }));
            break;

          case 'task':
            const agent = core.get('agent');
            if (agent) {
              const result = await agent.process({ description: msg.task, type: msg.taskType || 'bash' });
              ws.send(JSON.stringify({ type: 'task_result', data: result }));
            }
            break;

          case 'tool':
            const tools = core.get('tools');
            if (tools) {
              const toolResult = await tools.execute(msg.name, msg.args || {});
              ws.send(JSON.stringify({ type: 'tool_result', data: toolResult }));
            }
            break;

          case 'status':
            ws.send(JSON.stringify({ type: 'status', data: core.getStatus() }));
            break;

          case 'stop':
            const loopCtrl = core.get('loop');
            if (loopCtrl) loopCtrl.stop();
            broadcast({ type: 'loop_stopped' });
            break;

          case 'pause':
            const loopPause = core.get('loop');
            if (loopPause) loopPause.pause();
            broadcast({ type: 'loop_paused' });
            break;

          case 'resume':
            const loopResume = core.get('loop');
            if (loopResume) loopResume.resume();
            broadcast({ type: 'loop_resumed' });
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', data: { message: `Unknown message type: ${msg.type}` } }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      log.info('WebSocket client disconnected', { total: clients.size });
    });
  });

  // Forward core events to all WebSocket clients
  function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) { // OPEN
        client.send(data);
      }
    }
  }

  core.on('stateChange', (data) => broadcast({ type: 'state_change', data }));
  core.on('goalSet', (data) => broadcast({ type: 'goal_set', data }));
  core.on('goalComplete', (data) => broadcast({ type: 'goal_complete', data }));
  core.on('taskStart', (data) => broadcast({ type: 'task_start', data }));
  core.on('taskEnd', (data) => broadcast({ type: 'task_end', data }));
  core.on('loopStart', (data) => broadcast({ type: 'loop_start', data }));
  core.on('loopEnd', (data) => broadcast({ type: 'loop_end', data }));

  log.info('WebSocket server initialized');
  return { wss, broadcast };
}

export default createWebSocket;
