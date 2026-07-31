import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export function LoadingScreen() {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[var(--bg-primary)]">
      <motion.div
        className="flex flex-col items-center gap-6"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="relative">
          <motion.div
            className="h-16 w-16 rounded-full border-4 border-[var(--border-primary)] border-t-[var(--accent)]"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-game text-lg font-bold text-[var(--accent)]">R</span>
          </div>
        </div>

        <div className="text-center">
          <h2 className="font-game text-xl font-semibold text-[var(--text-primary)]">
            {t('gameTitle')}
          </h2>
          <motion.p
            className="mt-2 text-sm text-[var(--text-muted)]"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {t('loading')}
          </motion.p>
        </div>
      </motion.div>
    </div>
  );
}
