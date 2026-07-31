import { useTranslation } from 'react-i18next';
import { useSaveStore } from '@/stores/saveStore';

const LANGUAGE_NAMES: Record<string, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
};

export function TranslationConfirmDialog() {
  const { t } = useTranslation('settings');
  const languageMismatch = useSaveStore((s) => s.languageMismatch);
  const isTranslating = useSaveStore((s) => s.isTranslating);
  const confirmTranslation = useSaveStore((s) => s.confirmTranslation);
  const cancelTranslation = useSaveStore((s) => s.cancelTranslation);

  if (!languageMismatch) return null;

  const sourceName = LANGUAGE_NAMES[languageMismatch.saveLanguage] || languageMismatch.saveLanguage;
  const targetName = LANGUAGE_NAMES[languageMismatch.targetLanguage] || languageMismatch.targetLanguage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
          {t('languageMismatchTitle', '语言不匹配')}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          {t('languageMismatchDesc', '此存档的语言为 {{source}}，当前设置为 {{target}}。是否翻译存档数据？')
            .replace('{{source}}', sourceName)
            .replace('{{target}}', targetName)}
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={cancelTranslation}
            disabled={isTranslating}
            className="px-4 py-2 text-sm rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {t('languageMismatchCancel', '保持原语言')}
          </button>
          <button
            onClick={confirmTranslation}
            disabled={isTranslating}
            className="px-4 py-2 text-sm rounded-md bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {isTranslating ? t('languageMismatchTranslating', '翻译中...') : t('languageMismatchConfirm', '翻译存档数据')}
          </button>
        </div>
      </div>
    </div>
  );
}
