import { useState, useEffect } from 'react';
import { wsManager } from '@/services/WebSocketManager';
import type { WSConnectionState } from '@ai-rpg/shared';

interface UseWebSocketReturn {
  isConnected: boolean;
  connectionState: WSConnectionState;
  sendRequest: typeof wsManager.sendRequest;
  subscribe: typeof wsManager.subscribe;
  unsubscribe: typeof wsManager.unsubscribe;
  clientId: string;
}

export function useWebSocket(): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<WSConnectionState>(wsManager.state);

  useEffect(() => {
    const unsub = wsManager.onStateChange(setConnectionState);
    return unsub;
  }, []);

  return {
    isConnected: connectionState === 'connected',
    connectionState,
    sendRequest: wsManager.sendRequest.bind(wsManager),
    subscribe: wsManager.subscribe.bind(wsManager),
    unsubscribe: wsManager.unsubscribe.bind(wsManager),
    clientId: wsManager.clientId,
  };
}
