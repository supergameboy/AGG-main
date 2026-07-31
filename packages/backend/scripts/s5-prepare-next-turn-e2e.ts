/**
 * M5 S5 手工 E2E：gamemaster 多轮叙事观察 prepareNextTurn 模型切换日志。
 *
 * 用法：pnpm --filter @ai-rpg/backend exec tsx scripts/s5-prepare-next-turn-e2e.ts
 * 前置：backend dev 服务已启动（17334），fast tier 已配置（llama-3.2-3b-instruct）。
 */
import WebSocket from 'ws';

const WS_URL = process.env.WS_URL ?? 'ws://localhost:17334/ws';
const SAVE_ID = process.env.SAVE_ID ?? 'save_人类_1785039605609_0';
const MESSAGE =
  process.env.CHAT_MESSAGE ??
  '我仔细查看当前的任务状态、背包物品和周围环境，然后决定下一步行动。';

const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 600_000);

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
  const ws = new WebSocket(WS_URL);
  const requestId = uid('req');

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);

    ws.on('open', () => {
      console.log('[e2e] ws connected, sending auth');
      ws.send(JSON.stringify({ type: 'auth', clientId: uid('client_s5e2e') }));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.type === 'auth_result') {
        console.log('[e2e] auth_result:', JSON.stringify(msg));
        if (msg.success === false) {
          clearTimeout(timer);
          reject(new Error('auth failed'));
          return;
        }
        const request = {
          type: 'game:request',
          requestId,
          module: 'game',
          action: 'chat',
          intentHint: 's5_e2e_prepare_next_turn',
          payload: { message: MESSAGE, saveId: SAVE_ID },
        };
        console.log('[e2e] sending chat request:', JSON.stringify({ requestId, saveId: SAVE_ID, message: MESSAGE }));
        ws.send(JSON.stringify(request));
        return;
      }

      if (msg.type === 'game:result' && msg.requestId === requestId) {
        clearTimeout(timer);
        const data = msg.data as Record<string, unknown> | undefined;
        const success = data?.success;
        console.log('[e2e] game:result received. success =', success);
        const innerData = (data?.data ?? {}) as Record<string, unknown>;
        const panelUpdates = (innerData.panelUpdates ?? {}) as Record<string, unknown>;
        const dialogue = (panelUpdates.dialogue ?? {}) as Record<string, unknown>;
        const added = (dialogue.addedMessages ?? []) as Array<Record<string, unknown>>;
        for (const m of added.slice(0, 3)) {
          const content = String(m.content ?? '').slice(0, 200);
          console.log(`[e2e] dialogue[${m.role ?? '?'}]: ${content}`);
        }
        resolve();
        return;
      }

      if (msg.type === 'game:error' && msg.requestId === requestId) {
        clearTimeout(timer);
        reject(new Error(`game:error ${JSON.stringify(msg)}`));
      }
    });

    ws.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  await done;
  ws.close();
  console.log('[e2e] done');
}

main().catch((err) => {
  console.error('[e2e] failed:', err);
  process.exit(1);
});
