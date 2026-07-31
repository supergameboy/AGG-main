import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { logger } from '@/utils/logger';
import './i18n';
import './index.css';

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
    <App />
  </React.StrictMode>
);
