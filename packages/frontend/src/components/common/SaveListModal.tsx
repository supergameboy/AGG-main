import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ClockIcon, MapPinIcon, MagnifyingGlassIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon, ArrowDownTrayIcon, DocumentDuplicateIcon, ArrowUpTrayIcon, ChevronDownIcon, FolderIcon, ArrowPathIcon, BookmarkSquareIcon } from '@heroicons/react/24/outline';
import { apiClient } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import type { SnapshotType } from '../../../../shared/src/types/api';
import type { SaveRestrictionType } from '../../../../shared/src/types/template';

interface SaveData {
  id: string;
  name: string;
  type: SaveRestrictionType;
  level?: number;
  location?: string;
  chapter?: string;
  play_time?: number;
  updated_at: string;
  snapshot_count?: number;
  current_snapshot_id?: string | null;
}

interface SnapshotData {
  id: string;
  save_id: string;
  name: string;
  type: SnapshotType;
  game_mode: string;
  chapter: string;
  location: string;
  level: number;
  main_quest: string;
  play_time: number;
  thumbnail: string;
  description?: string;
  created_at: number;
}

interface SaveListModalProps {
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 10;

const SNAPSHOT_TYPE_CONFIG: Record<SnapshotType, { labelKey: string; color: string; bgColor: string }> = {
  auto: { labelKey: 'saveList.snapshotType.auto', color: 'text-blue-300', bgColor: 'bg-blue-500/20 border-blue-500/30' },
  manual: { labelKey: 'saveList.snapshotType.manual', color: 'text-green-300', bgColor: 'bg-green-500/20 border-green-500/30' },
  checkpoint: { labelKey: 'saveList.snapshotType.checkpoint', color: 'text-orange-300', bgColor: 'bg-orange-500/20 border-orange-500/30' },
};

const SAVE_RESTRICTION_LABELS: Record<SaveRestrictionType, { labelKey: string; color: string; bgColor: string }> = {
  free: { labelKey: 'saveList.restriction.free', color: 'text-green-300', bgColor: 'bg-green-500/20 border-green-500/30' },
  checkpoint_only: { labelKey: 'saveList.restriction.checkpointOnly', color: 'text-orange-300', bgColor: 'bg-orange-500/20 border-orange-500/30' },
  manual_only: { labelKey: 'saveList.restriction.manualOnly', color: 'text-blue-300', bgColor: 'bg-blue-500/20 border-blue-500/30' },
  ironman: { labelKey: 'saveList.restriction.ironman', color: 'text-red-300', bgColor: 'bg-red-500/20 border-red-500/30' },
};

function formatRelativeTime(timestamp: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t('saveList.time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('saveList.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('saveList.time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('saveList.time.daysAgo', { count: days });
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatPlayTime(seconds: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!seconds) return t('saveList.time.zeroMinutes');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return t('saveList.time.hoursMinutes', { hours: h, minutes: m });
  return t('saveList.time.minutesOnly', { minutes: m });
}

function formatDate(dateStr: string | number): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

function SnapshotItem({
  snapshot,
  onRestore,
  onDelete,
  canDelete,
}: {
  snapshot: SnapshotData;
  onRestore: (snapshot: SnapshotData) => void;
  onDelete: (snapshotId: string) => void;
  canDelete: boolean;
}) {
  const { t } = useTranslation('common');
  const [confirmAction, setConfirmAction] = useState<'restore' | 'delete' | null>(null);
  const typeConfig = SNAPSHOT_TYPE_CONFIG[snapshot.type] || SNAPSHOT_TYPE_CONFIG.auto;

  if (confirmAction === 'restore') {
    return (
      <div className="flex items-center justify-between rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3">
        <span className="text-sm text-[var(--text-primary)]">{t('saveList.confirmRestore')}</span>
        <div className="flex gap-2">
          <button
            onClick={() => { onRestore(snapshot); setConfirmAction(null); }}
            className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            {t('saveList.confirmRestoreBtn')}
          </button>
          <button
            onClick={() => setConfirmAction(null)}
            className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    );
  }

  if (confirmAction === 'delete') {
    return (
      <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/5 p-3">
        <span className="text-sm text-[var(--text-primary)]">{t('saveList.confirmDeleteSnapshot')}</span>
        <div className="flex gap-2">
          <button
            onClick={() => { onDelete(snapshot.id); setConfirmAction(null); }}
            className="rounded-md bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
          >
            {t('saveList.confirmDelete')}
          </button>
          <button
            onClick={() => setConfirmAction(null)}
            className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-[var(--border-primary)]/50 bg-[var(--bg-primary)]/50 p-3 transition-colors hover:border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]/50">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${typeConfig.color} ${typeConfig.bgColor}`}>
        {t(typeConfig.labelKey)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">{snapshot.name}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
          {snapshot.chapter && <span>{snapshot.chapter}</span>}
          {snapshot.location && (
            <span className="flex items-center gap-0.5">
              <MapPinIcon className="h-2.5 w-2.5" />
              {snapshot.location}
            </span>
          )}
          {snapshot.level > 0 && <span>Lv.{snapshot.level}</span>}
          {snapshot.play_time > 0 && (
            <span className="flex items-center gap-0.5">
              <ClockIcon className="h-2.5 w-2.5" />
              {formatPlayTime(snapshot.play_time, t)}
            </span>
          )}
          <span title={formatDate(snapshot.created_at)}>{formatRelativeTime(snapshot.created_at, t)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setConfirmAction('restore')}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
          title={t('saveList.restoreSnapshot')}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" />
        </button>
        {canDelete && (
          <button
            onClick={() => setConfirmAction('delete')}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
            title={t('saveList.deleteSnapshot')}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function SaveListModal({ open, onClose }: SaveListModalProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const [saves, setSaves] = useState<SaveData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedSaveId, setExpandedSaveId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotData[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotFilter, setSnapshotFilter] = useState<SnapshotType | 'all'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCopySave = async (saveId: string, saveName: string) => {
    try {
      await apiClient.post(`/saves/${saveId}/copy`, { name: `${saveName} (${t('saveList.copySuffix')})` });
      fetchSaves();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('saveList.copyFailed'));
    }
  };

  const handleImportSave = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await apiClient.post('/saves/import', { data });
      fetchSaves();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('saveList.importFailed'));
    }
  };

  const handleDeleteSave = async (saveId: string) => {
    try {
      await apiClient.delete(`/saves/${saveId}`);
      setDeleteConfirmId(null);
      if (expandedSaveId === saveId) setExpandedSaveId(null);
      fetchSaves();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('saveList.deleteSaveFailed'));
    }
  };

  const handleExportSave = async (saveId: string, saveName: string) => {
    try {
      const data = await apiClient.post(`/saves/${saveId}/export`, {});
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${saveName || 'save'}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('saveList.exportFailed'));
    }
  };

  const handleToggleExpand = async (saveId: string) => {
    if (expandedSaveId === saveId) {
      setExpandedSaveId(null);
      setSnapshots([]);
      return;
    }
    setExpandedSaveId(saveId);
    setSnapshotFilter('all');
    setSnapshotsLoading(true);
    try {
      const params = new URLSearchParams();
      const data = await apiClient.get(`/saves/${saveId}/snapshots?${params.toString()}`);
      setSnapshots((data as unknown as SnapshotData[]) || []);
    } catch {
      setSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const handleRestoreSnapshot = async (snapshot: SnapshotData) => {
    try {
      await apiClient.post(`/saves/${snapshot.save_id}/snapshots/${snapshot.id}/restore`);
      navigate(`/game/${snapshot.save_id}`);
      onClose();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('saveList.restoreSnapshotFailed'));
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    if (!expandedSaveId) return;
    try {
      await apiClient.delete(`/saves/${expandedSaveId}/snapshots/${snapshotId}`);
      setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
      fetchSaves();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('saveList.deleteSnapshotFailed'));
    }
  };

  const handleFilterSnapshots = async (filter: SnapshotType | 'all') => {
    setSnapshotFilter(filter);
    if (!expandedSaveId) return;
    setSnapshotsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('type', filter);
      const data = await apiClient.get(`/saves/${expandedSaveId}/snapshots?${params.toString()}`);
      setSnapshots((data as unknown as SnapshotData[]) || []);
    } catch {
      setSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const fetchSaves = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    if (search.trim()) params.set('nameContains', search.trim());
    apiClient.get<{ saves: SaveData[]; total: number }>(`/saves?${params.toString()}`)
      .then((data) => {
        const result = data as unknown as { saves: SaveData[]; total: number };
        setSaves(result.saves || []);
        setTotal(result.total || 0);
      })
      .catch((err) => {
        setError(err.message || t('saveList.loadFailed'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [page, search]);

  useEffect(() => {
    if (open) {
      setPage(1);
      setSearch('');
      setExpandedSaveId(null);
      setSnapshots([]);
      fetchSaves();
    }
  }, [open]);

  useEffect(() => {
    if (open) fetchSaves();
  }, [page, search, open, fetchSaves]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSelectSave = (saveId: string) => {
    navigate(`/game/${saveId}`);
    onClose();
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const filteredSnapshots = snapshotFilter === 'all'
    ? snapshots
    : snapshots.filter((s) => s.type === snapshotFilter);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('saveList.continueGame')}
        size="lg"
        footer={
          totalPages > 1 ? (
            <div className="flex w-full items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                {t('saveList.totalSaves', { count: total })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <span className="text-xs text-[var(--text-muted)]">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : undefined
        }
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t('saveList.searchPlaceholder')}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            title={t('saveList.importSave')}
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            <span>{t('import')}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportSave(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="mt-3">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              <span className="ml-3 text-sm text-[var(--text-muted)]">{t('saveList.loadingSaves')}</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5 p-4 text-center">
              <p className="text-sm text-[var(--error)]">{error}</p>
            </div>
          )}

          {!loading && !error && saves.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-[var(--text-muted)]">
                {search ? t('saveList.noMatchFound') : t('saveList.noSaves')}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {search ? t('saveList.tryOtherKeywords') : t('saveList.autoCreateHint')}
              </p>
            </div>
          )}

          {!loading && saves.length > 0 && (
            <div className="space-y-2">
              {saves.map((save) => {
                const isExpanded = expandedSaveId === save.id;
                const restrictionConfig = SAVE_RESTRICTION_LABELS[save.type] || SAVE_RESTRICTION_LABELS.free;
                const isIronman = save.type === 'ironman';

                return (
                  <div key={save.id}>
                    <motion.div
                      className="w-full cursor-pointer rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 text-left transition-all hover:border-[var(--accent)]/50 hover:bg-[var(--bg-primary)]"
                      whileHover={{ scale: 1.005 }}
                      whileTap={{ scale: 0.995 }}
                      role="article"
                      aria-label={t('saveList.saveItem', { name: save.name || t('saveList.unnamedSave') })}
                      onClick={() => handleToggleExpand(save.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                            title={isExpanded ? t('collapse') : t('expand')}
                          >
                            <ChevronDownIcon className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-[var(--text-primary)]">
                                {save.name || t('saveList.unnamedSave')}
                              </h3>
                              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${restrictionConfig.color} ${restrictionConfig.bgColor}`}>
                                {t(restrictionConfig.labelKey)}
                              </span>
                            </div>
                            {save.level != null && (
                              <span className="mt-0.5 inline-block rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                                Lv.{save.level}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {save.snapshot_count != null && save.snapshot_count > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                              <FolderIcon className="h-3 w-3" />
                              {save.snapshot_count}
                            </span>
                          )}
                          <span className="text-xs text-[var(--text-muted)]">
                            {formatDate(save.updated_at)}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectSave(save.id); }}
                            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
                            title={t('saveList.loadSave')}
                          >
                            <BookmarkSquareIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopySave(save.id, save.name); }}
                            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                            title={t('saveList.copySave')}
                          >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExportSave(save.id, save.name); }}
                            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                            title={t('saveList.exportSave')}
                          >
                            <ArrowDownTrayIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(save.id); }}
                            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                            title={t('saveList.deleteSave')}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--text-muted)]">
                        {save.location ? (
                          <span className="flex items-center gap-1">
                            <MapPinIcon className="h-3 w-3" />
                            {save.location}
                          </span>
                        ) : null}
                        {save.play_time != null && (
                          <span className="flex items-center gap-1">
                            <ClockIcon className="h-3 w-3" />
                            {formatPlayTime(save.play_time, t)}
                          </span>
                        )}
                      </div>
                    </motion.div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="ml-6 mt-1 space-y-1.5 border-l-2 border-[var(--border-primary)]/30 pl-4">
                            <div className="flex items-center gap-2 py-1">
                              <span className="text-xs text-[var(--text-muted)]">{t('saveList.snapshotList')}</span>
                              <div className="flex gap-1">
                                {(['all', 'auto', 'manual', 'checkpoint'] as const).map((filter) => (
                                  <button
                                    key={filter}
                                    onClick={() => handleFilterSnapshots(filter)}
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                      snapshotFilter === filter
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                    }`}
                                  >
                                    {filter === 'all' ? t('saveList.filterAll') : t(SNAPSHOT_TYPE_CONFIG[filter].labelKey)}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {snapshotsLoading && (
                              <div className="flex items-center gap-2 py-4">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                                <span className="text-xs text-[var(--text-muted)]">{t('saveList.loadingSnapshots')}</span>
                              </div>
                            )}

                            {!snapshotsLoading && filteredSnapshots.length === 0 && (
                              <p className="py-3 text-xs text-[var(--text-muted)]">{t('saveList.noSnapshots')}</p>
                            )}

                            {!snapshotsLoading && filteredSnapshots.map((snapshot) => (
                              <SnapshotItem
                                key={snapshot.id}
                                snapshot={snapshot}
                                onRestore={handleRestoreSnapshot}
                                onDelete={handleDeleteSnapshot}
                                canDelete={!isIronman}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {deleteConfirmId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--bg-overlay)]">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 shadow-xl">
            <h3 className="text-lg font-medium text-[var(--text-primary)]">{t('saveList.confirmDelete')}</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t('saveList.confirmDeleteSaveMsg')}</p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-primary)]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => handleDeleteSave(deleteConfirmId)}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
