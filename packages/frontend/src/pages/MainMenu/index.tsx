import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PlayIcon, ArrowPathIcon, Cog6ToothIcon, SunIcon, MoonIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { useTheme } from '@/hooks/useTheme';
import { SaveListModal } from '@/components/common/SaveListModal';

export default function MainMenu() {
  const navigate = useNavigate();
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <div className="relative flex h-screen w-full items-center justify-center bg-[var(--bg-primary)]">
      <motion.div
        className="flex flex-col items-center gap-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-center">
          <h1 className="font-game text-4xl font-bold text-[var(--accent)]">
            AI-generated Games
          </h1>
          <p className="mt-2 text-[var(--text-secondary)]">
            由大语言模型驱动的角色扮演游戏引擎
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            multi-agent-generative-rpg-engine
          </p>
        </div>

        <div className="flex flex-col gap-3 w-64">
          <motion.button
            onClick={() => navigate('/select-template')}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-6 py-3 text-base font-semibold text-white shadow-md transition-colors hover:bg-[var(--accent-hover)]"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <PlayIcon className="h-5 w-5" />
            新游戏
          </motion.button>

          <motion.button
            onClick={() => setSaveModalOpen(true)}
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-6 py-3 text-base font-medium text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-secondary)]"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <ArrowPathIcon className="h-5 w-5" />
            继续游戏
          </motion.button>

          <motion.button
            onClick={() => navigate('/settings')}
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-6 py-3 text-base font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-secondary)]"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Cog6ToothIcon className="h-5 w-5" />
            设置
          </motion.button>

          <motion.button
            onClick={() => navigate('/templates')}
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-6 py-3 text-base font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-secondary)]"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <DocumentDuplicateIcon className="h-5 w-5" />
            模板编辑器
          </motion.button>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          v1.0.0
        </p>
      </motion.div>

      <button
        onClick={toggleTheme}
        className="fixed bottom-6 right-6 rounded-full border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 text-[var(--text-secondary)] shadow-md transition-colors hover:bg-[var(--bg-secondary)]"
        aria-label="切换主题"
      >
        {resolvedTheme === 'dark' ? (
          <SunIcon className="h-5 w-5" />
        ) : (
          <MoonIcon className="h-5 w-5" />
        )}
      </button>

      <SaveListModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
      />
    </div>
  );
}
