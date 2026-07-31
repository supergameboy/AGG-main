import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { oauthApi } from '@/api/oauthApi';
import type { OAuthLoginBeginResult, OAuthLoginStatus } from '@/api/oauthApi';

const POLL_INTERVAL_MS = 2000;

interface OAuthLoginModalProps {
  open: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
  /** 登录成功回调（父组件刷新 provider 列表与 OAuth 状态） */
  onSuccess: () => void;
}

/**
 * OAuth 设备码登录弹窗（M2-B3 D10）
 *
 * 状态机：打开 → login 获取设备码 → 2s 轮询 status →
 *   success（自动关闭 + 回调刷新）/ failed（展示错误，可重试）
 * 关闭弹窗不中止后台轮询（后端会话幂等保留），"取消登录"才调 logout 中止。
 */
export function OAuthLoginModal({ open, onClose, providerId, providerName, onSuccess }: OAuthLoginModalProps) {
  const [loginInfo, setLoginInfo] = useState<OAuthLoginBeginResult | null>(null);
  const [status, setStatus] = useState<OAuthLoginStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const beginLogin = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const info = await oauthApi.login(providerId);
      setLoginInfo(info);
      setStatus('pending');
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : '发起登录失败');
    } finally {
      setStarting(false);
    }
  }, [providerId]);

  useEffect(() => {
    if (!open) {
      stopPolling();
      setLoginInfo(null);
      setStatus('idle');
      setError(null);
      setCopied(false);
      return;
    }
    void beginLogin();
  }, [open, beginLogin, stopPolling]);

  useEffect(() => {
    if (!open || status !== 'pending') return;

    pollTimerRef.current = setInterval(async () => {
      try {
        const result = await oauthApi.status(providerId);
        if (result.status === 'success') {
          stopPolling();
          setStatus('success');
          onSuccess();
          onClose();
        } else if (result.status === 'failed') {
          stopPolling();
          setStatus('failed');
          setError(result.error ?? '登录失败');
        } else if (result.status === 'idle') {
          // 后端会话被外部中止（如 logout）
          stopPolling();
          setStatus('failed');
          setError('登录会话已取消');
        }
      } catch {
        // 单次轮询网络错误不致命，等待下一轮
      }
    }, POLL_INTERVAL_MS);

    return stopPolling;
  }, [open, status, providerId, stopPolling, onSuccess, onClose]);

  const handleCopyCode = useCallback(async () => {
    if (!loginInfo?.userCode) return;
    try {
      await navigator.clipboard.writeText(loginInfo.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默（用户可手动复制）
    }
  }, [loginInfo?.userCode]);

  const handleCancelLogin = useCallback(async () => {
    stopPolling();
    try {
      await oauthApi.logout(providerId);
    } catch {
      // logout 失败不阻塞关闭
    }
    onClose();
  }, [providerId, stopPolling, onClose]);

  const handleRetry = useCallback(() => {
    void beginLogin();
  }, [beginLogin]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`登录 ${providerName}`}
      size="md"
      footer={
        status === 'failed' ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
            <Button variant="primary" size="sm" onClick={handleRetry} loading={starting}>
              重试
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              稍后完成
            </Button>
            <Button variant="danger" size="sm" onClick={handleCancelLogin}>
              取消登录
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {status === 'idle' && starting && (
          <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
            <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            正在获取设备码…
          </div>
        )}

        {status === 'pending' && loginInfo && (
          <>
            <p className="text-sm text-[var(--text-secondary)]">
              请访问以下链接，并输入设备码完成授权：
            </p>

            <a
              href={loginInfo.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/10"
            >
              {loginInfo.verificationUri}
            </a>

            <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 py-5">
              <span className="text-xs text-[var(--text-muted)]">设备码</span>
              <span className="font-mono text-2xl font-bold tracking-[0.2em] text-[var(--text-primary)]">
                {loginInfo.userCode}
              </span>
              <Button variant="outline" size="sm" onClick={handleCopyCode}>
                {copied ? '已复制' : '复制设备码'}
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              等待授权中…完成后此窗口将自动关闭
              {loginInfo.expiresInSeconds ? `（设备码 ${Math.floor(loginInfo.expiresInSeconds / 60)} 分钟内有效）` : ''}
            </div>
          </>
        )}

        {status === 'failed' && (
          <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 p-3 text-sm text-[var(--error)]">
            登录失败: {error ?? '未知错误'}
          </div>
        )}
      </div>
    </Modal>
  );
}
