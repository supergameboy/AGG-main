import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createRouter } from './App';
import { useLogStore } from '@/stores/logStore';
import { logger } from '@/utils/logger';
import './i18n';
import './styles/globals.css';

useLogStore.getState().startCapturing();
useLogStore.getState().setPersistToBackend(true);

window.onerror = (message, source, lineno, colno, error) => {
  logger.error('global', String(message), { source, lineno, colno }, error?.stack);
  return false;
};

window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('global', `Unhandled rejection: ${msg}`, undefined, stack);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={createRouter()} future={{ v7_startTransition: true }} />
  </React.StrictMode>
);
