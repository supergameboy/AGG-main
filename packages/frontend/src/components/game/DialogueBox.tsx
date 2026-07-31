import { useState, useEffect, useRef, useCallback, useMemo, forwardRef } from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/utils/cn';

export interface DialogueMessage {
  id?: string;
  speaker: string;
  content: string;
  emotion?: string;
  isPlayer?: boolean;
  messageType?: string;
  timestamp?: number;
}

export interface DialogueOption {
  id?: string;
  text: string;
  npcId: string;
}

export interface DialogueBoxProps {
  messages: DialogueMessage[];
  options?: DialogueOption[];
  onOptionSelect?: (option: DialogueOption, index: number) => void;
  onSendMessage?: (message: string) => void;
  isTyping?: boolean;
  disabled?: boolean;
  typingSpeed?: number;
  className?: string;
  npcInfoList?: Array<{ id: string; name: string; locationId?: string }>;
  targetNpcIds?: string[];
  onToggleTargetNpc?: (npcId: string) => void;
  currentLocationId?: string;
  hasKp?: boolean;
}

const EMOTION_COLORS: Record<string, string> = {
  friendly: 'var(--success)',
  happy: 'var(--gold)',
  angry: 'var(--error)',
  sad: 'var(--info)',
  neutral: 'var(--text-muted)',
  mysterious: 'var(--epic)',
  fearful: 'var(--warning)',
  surprised: 'var(--accent)',
  worried: 'var(--warning)',
  cautious: 'var(--info)',
  curious: 'var(--accent)',
  annoyed: 'var(--error)',
  gruff: 'var(--text-muted)',
  hopeful: 'var(--success)',
  desperate: 'var(--error)',
  calm: 'var(--text-muted)',
  excited: 'var(--gold)',
  cold: 'var(--info)',
  proud: 'var(--epic)',
  ashamed: 'var(--text-muted)',
  confused: 'var(--info)',
  disgusted: 'var(--error)',
  lonely: 'var(--info)',
  relieved: 'var(--success)',
  shy: 'var(--accent)',
  smug: 'var(--gold)',
  stern: 'var(--text-muted)',
  terrified: 'var(--error)',
  thoughtful: 'var(--info)',
  tired: 'var(--text-muted)',
  trusting: 'var(--success)',
};

function getEmotionColor(emotion?: string): string {
  if (!emotion) return 'var(--text-muted)';
  return EMOTION_COLORS[emotion.toLowerCase()] ?? 'var(--text-muted)';
}

function TypewriterText({ text, speed, onSkip, onComplete }: {
  text: string;
  speed: number;
  onSkip: () => void;
  onComplete: () => void;
}) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const isComplete = displayedLength >= text.length;

  useEffect(() => {
    setDisplayedLength(0);
  }, [text]);

  useEffect(() => {
    if (isComplete) {
      onComplete();
      return;
    }
    const timer = setInterval(() => {
      setDisplayedLength((prev) => {
        const next = prev + 1;
        if (next >= text.length) {
          clearInterval(timer);
        }
        return next;
      });
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed, isComplete, onComplete]);

  return (
    <span onClick={onSkip} className="cursor-pointer">
      {text.slice(0, displayedLength)}
      {!isComplete && (
        <span className="inline-block w-[2px] animate-pulse bg-[var(--text-primary)] ml-px align-text-bottom" style={{ height: '1em' }} />
      )}
    </span>
  );
}

type VirtualItem =
  | { type: 'message'; msg: DialogueMessage; index: number }
  | { type: 'typing'; msg: null; index: -1 };

const VirtualMessageItem = forwardRef<HTMLDivElement, {
  msg: DialogueMessage;
  msgId: string;
  shouldAnimate: boolean;
  typingSpeed: number;
  onSkip: (msgId: string) => void;
  onTypewriterComplete: (msgId: string) => void;
  style: React.CSSProperties;
  dataIndex: number;
  isKp: boolean;
}>(function VirtualMessageItem({
  msg,
  msgId,
  shouldAnimate,
  typingSpeed,
  onSkip,
  onTypewriterComplete,
  style,
  dataIndex,
  isKp,
}, ref) {
  const isKpMessage = isKp && !msg.isPlayer && (msg.speaker === 'KP' || msg.speaker === '守密人');
  return (
    <div
      ref={ref}
      style={style}
      data-index={dataIndex}
      className={cn(
        'flex flex-col gap-1 pb-3',
        msg.isPlayer ? 'items-end' : 'items-start'
      )}
    >
      {msg.speaker && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs font-semibold',
              isKpMessage ? 'text-amber-400' : 'text-[var(--accent)]'
            )}
          >
            {msg.speaker}
          </span>
          {msg.emotion && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium border"
              style={{
                color: getEmotionColor(msg.emotion),
                borderColor: getEmotionColor(msg.emotion),
                backgroundColor: `color-mix(in srgb, ${getEmotionColor(msg.emotion)} 10%, transparent)`,
              }}
            >
              {msg.emotion}
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2.5 font-game text-[length:var(--text-dialogue)] leading-[var(--leading-game)]',
          isKpMessage
            ? 'border-l-4 border-amber-400 bg-amber-950/20 text-amber-100 italic'
            : msg.isPlayer
              ? 'bg-[color-mix(in_srgb,_var(--accent)_10%,_transparent)] text-[var(--text-primary)]'
              : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
        )}
      >
        {shouldAnimate ? (
          <TypewriterText
            text={msg.content}
            speed={typingSpeed}
            onSkip={() => onSkip(msgId)}
            onComplete={() => onTypewriterComplete(msgId)}
          />
        ) : (
          msg.content
        )}
      </div>
    </div>
  );
});

export function DialogueBox({
  messages,
  options = [],
  onOptionSelect,
  onSendMessage,
  isTyping = false,
  disabled = false,
  typingSpeed = 30,
  className,
  npcInfoList,
  targetNpcIds = [],
  onToggleTargetNpc,
  currentLocationId,
  hasKp = false,
}: DialogueBoxProps) {
  const [inputValue, setInputValue] = useState('');
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems = useMemo(() => {
    const items: VirtualItem[] =
      messages.map((msg, index) => ({ type: 'message' as const, msg, index }));
    if (isTyping) {
      items.push({ type: 'typing' as const, msg: null, index: -1 });
    }
    return items;
  }, [messages, isTyping]);

  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const item = allItems[index];
      if (!item || item.type === 'typing') return 48;
      const contentLength = item.msg.content.length;
      if (contentLength > 200) return 120;
      if (contentLength > 100) return 80;
      return 60;
    },
    measureElement: (el) => el?.getBoundingClientRect().height ?? 60,
    overscan: 5,
  });

  const getMessageId = useCallback((msg: DialogueMessage, index: number) => {
    return msg.id ?? `${msg.speaker}-${msg.timestamp ?? index}`;
  }, []);

  useEffect(() => {
    if (allItems.length > 0) {
      virtualizer.scrollToIndex(allItems.length - 1, { align: 'end' });
    }
  }, [allItems.length, completedIds, virtualizer]);

  const handleSkip = useCallback((msgId: string) => {
    setSkippedIds((prev) => new Set(prev).add(msgId));
  }, []);

  const handleTypewriterComplete = useCallback((msgId: string) => {
    setCompletedIds((prev) => new Set(prev).add(msgId));
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !onSendMessage) return;
    onSendMessage(trimmed);
    setInputValue('');
    inputRef.current?.focus();
  }, [inputValue, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleOptionClick = useCallback((option: DialogueOption, index: number) => {
    onOptionSelect?.(option, index);
  }, [onOptionSelect]);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden',
        className
      )}
    >
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 scrollbar-thin"
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = allItems[virtualItem.index];
            if (!item) return null;

            if (item.type === 'typing') {
              return (
                <div
                  key="typing"
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: virtualItem.start,
                    left: 0,
                    width: '100%',
                  }}
                  className="flex items-start gap-1 pb-3"
                >
                  <span className="text-xs font-semibold text-[var(--accent)]">...</span>
                  <div className="rounded-lg bg-[var(--bg-secondary)] px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            const msg = item.msg;
            const msgId = getMessageId(msg, item.index);
            const isSkipped = skippedIds.has(msgId);
            const isCompleted = completedIds.has(msgId);
            const isLastMessage = item.index === messages.length - 1;
            const shouldAnimate = isLastMessage && !isSkipped && !isCompleted && !msg.isPlayer;

            return (
              <VirtualMessageItem
                key={virtualItem.key}
                msg={msg}
                msgId={msgId}
                shouldAnimate={shouldAnimate}
                typingSpeed={typingSpeed}
                onSkip={handleSkip}
                onTypewriterComplete={handleTypewriterComplete}
                style={{
                  position: 'absolute',
                  top: virtualItem.start,
                  left: 0,
                  width: '100%',
                }}
                dataIndex={virtualItem.index}
                isKp={hasKp}
                ref={virtualizer.measureElement}
              />
            );
          })}
        </div>
      </div>

      {options.length > 0 && (
        <div className="shrink-0 border-t border-[var(--border-primary)] px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {options.map((option, index) => (
              <button
                key={option.id ?? index}
                onClick={() => handleOptionClick(option, index)}
                className={cn(
                  'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2',
                  'text-sm text-[var(--text-primary)] font-game',
                  'transition-all duration-150',
                  'hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,_var(--accent)_10%,_transparent)] hover:text-[var(--accent)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
                  'active:scale-[0.98]'
                )}
              >
                {option.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {onSendMessage && (
        <div className="shrink-0 border-t border-[var(--border-primary)]">
          {npcInfoList && npcInfoList.length > 0 && onToggleTargetNpc && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <span className="text-xs text-[var(--text-muted)] shrink-0">对话对象:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {npcInfoList
                  .filter((npc) => !currentLocationId || npc.locationId === currentLocationId)
                  .map((npc) => {
                  const isSelected = targetNpcIds.includes(npc.id);
                  return (
                    <button
                      key={npc.id}
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs transition-colors',
                        isSelected
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                      )}
                      onClick={() => onToggleTargetNpc(npc.id)}
                    >
                      {npc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="px-4 py-3">
            <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? '连接已断开...' : '输入你的行动...'}
              disabled={disabled}
              className={cn(
                'flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2.5',
                'text-sm text-[var(--text-primary)] font-game',
                'placeholder:text-[var(--text-muted)]',
                'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20',
                'transition-all duration-150',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className={cn(
                'flex items-center justify-center rounded-lg px-4 py-2.5',
                'bg-[var(--accent)] text-white',
                'transition-all duration-150',
                'hover:bg-[var(--accent-hover)] hover:-translate-y-px',
                'active:translate-y-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0'
              )}
            >
              <PaperAirplaneIcon className="h-4 w-4" />
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
