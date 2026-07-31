import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { WSRequestBuilder } from '@/services/WSRequestBuilder';
import type { CharacterOptionsResponse, GeneratedOptionsStatus } from '@/api/templateApi';
import type { RaceDefinition, ClassDefinition, BackgroundDefinition, AttributeDefinition, CustomOption, AgeMode, AgeGroupDefinition, AgeNumberConfig } from '@/types';
import type { Gender, AgeGroup } from '@ai-rpg/shared';
import { GENDER_LABELS, DEFAULT_AGE_GROUP_LABELS } from '@ai-rpg/shared';
import { useGameStore } from '@/stores/gameStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { wsManager } from '@/services/WebSocketManager';
import { useWebSocket } from '@/hooks/useWebSocket';
import { InitProgressTree } from '@/components/game/InitProgressTree';
import { logger } from '@/utils/logger';
import { getAttributeColor, formatBonuses, formatPenalties } from '@/utils/entityMapper';

// 旧STEPS定义（注释保留）
// const STEPS = [
//   { key: 'race', label: '种族选择' },
//   { key: 'class', label: '职业选择' },
//   { key: 'background', label: '背景选择' },
//   { key: 'attributes', label: '属性分配' },
//   { key: 'confirm', label: '确认开始' },
// ];

const BASE_STEPS = [
  { key: 'name', labelKey: 'steps.name', required: true },
  { key: 'race', labelKey: 'steps.race', required: true },
  { key: 'class', labelKey: 'steps.class', required: true },
  { key: 'background', labelKey: 'steps.background', required: true },
  { key: 'attributes', labelKey: 'steps.attributes', required: true },
  { key: 'custom', labelKey: 'steps.custom', required: false },
  { key: 'confirm', labelKey: 'steps.confirm', required: true },
];

function buildAttributeNameMap(attributeDefs: AttributeDefinition[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const attr of attributeDefs) {
    map[attr.id] = attr.name;
  }
  return map;
}

export default function CharacterCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation('character');
  const templateId = searchParams.get('template');
  const initializeGame = useGameStore((s) => s.initializeGame);
  const storeInitProgressTree = useGameStore((s) => s.initProgressTree);
  const initState = useGameStore((s) => s.initState);
  const storeSaveId = useGameStore((s) => s.saveId);
  const registerWSHandlers = useGameStore((s) => s.registerWSHandlers);
  const aiGenerateOptions = useSettingsStore((s) => s.game.aiGenerateOptions);
  const { isConnected } = useWebSocket();

  const [templateData, setTemplateData] = useState<CharacterOptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedGender, setSelectedGender] = useState<Gender | ''>('');
  const [customGenderText, setCustomGenderText] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState<AgeGroup | ''>('');
  const [ageNumber, setAgeNumber] = useState<string>('');
  const [name, setName] = useState('');
  const [selectedRace, setSelectedRace] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedBackground, setSelectedBackground] = useState<string>('');
  const [attributes, setAttributes] = useState<Record<string, number>>({});
  const [customOptions, setCustomOptions] = useState<Record<string, string | number | boolean>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 注册 WS 消息处理器
  useEffect(() => {
    const unregister = registerWSHandlers();
    return unregister;
  }, [registerWSHandlers]);

  // 初始化完成后通过 initState 状态机跳转
  useEffect(() => {
    if (initState === 'done' && storeSaveId) {
      navigate(`/game/${storeSaveId}`);
    }
  }, [initState, storeSaveId, navigate]);

  // 初始化完成后 subscribe
  useEffect(() => {
    if (storeSaveId) {
      wsManager.subscribe(storeSaveId);
      return () => {
        wsManager.unsubscribe();
      };
    }
  }, [storeSaveId]);

  // AI选项生成相关状态
  const [aiSessionId, setAiSessionId] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGeneratedData, setAiGeneratedData] = useState<GeneratedOptionsStatus['data'] | null>(null);
  const [aiOptionsStatus, setAiOptionsStatus] = useState<'idle' | 'pending' | 'completed' | 'failed' | 'expired'>('idle');

  // 动态计算步骤：当 custom_options 为空时跳过 'custom' 步骤
  const customOptionsList = useMemo(() => templateData?.custom_options ?? [], [templateData]);
  const hasCustomOptions = customOptionsList.length > 0;

  const steps = useMemo(() => {
    if (hasCustomOptions) return BASE_STEPS;
    return BASE_STEPS.filter((s) => s.key !== 'custom');
  }, [hasCustomOptions]);

  useEffect(() => {
    if (!templateId) {
      navigate('/select-template', { replace: true });
      return;
    }
    wsManager.sendRequest(WSRequestBuilder.template.characterOptions({ templateId }))
      .then((response) => {
        const data = (response as { data: CharacterOptionsResponse }).data ?? response as unknown as CharacterOptionsResponse;
        setTemplateData(data);
        const initAttrs: Record<string, number> = {};
        (data.attributes ?? []).forEach((attr: AttributeDefinition) => {
          initAttrs[attr.id] = attr.default_value;
        });
        setAttributes(initAttrs);
        const initCustom: Record<string, string | number | boolean> = {};
        (data.custom_options ?? []).forEach((opt: CustomOption) => {
          initCustom[opt.id] = opt.default_value;
        });
        setCustomOptions(initCustom);
        setLoading(false);
      })
      .catch((err) => {
        logger.error('CharacterCreate', 'Failed to load character options', undefined, err instanceof Error ? err.stack : undefined);
        setLoadError(err instanceof Error ? err.message : t('loadOptionsFailed'));
        setLoading(false);
      });
  }, [templateId, navigate]);

  const races = useMemo(() => templateData?.races ?? [], [templateData]);
  const allClasses = useMemo(() => templateData?.classes ?? [], [templateData]);
  const backgrounds = useMemo(() => templateData?.backgrounds ?? [], [templateData]);
  const attributeDefs = useMemo(() => templateData?.attributes ?? [], [templateData]);
  const totalPoints = templateData?.attribute_points ?? 12;

  const attributeNameMap = useMemo(() => buildAttributeNameMap(attributeDefs), [attributeDefs]);

  // AI推荐选项合并到选项列表
  const mergedRaces = useMemo(() => {
    if (!aiGeneratedData?.races?.length) return races;
    const existingIds = new Set(races.map((r) => r.id));
    return [...races, ...aiGeneratedData.races.filter((r) => !existingIds.has(r.id))];
  }, [races, aiGeneratedData]);

  const mergedClasses = useMemo(() => {
    if (!aiGeneratedData?.classes?.length) return allClasses;
    const existingIds = new Set(allClasses.map((c) => c.id));
    return [...allClasses, ...aiGeneratedData.classes.filter((c) => !existingIds.has(c.id))];
  }, [allClasses, aiGeneratedData]);

  const mergedBackgrounds = useMemo(() => {
    if (!aiGeneratedData?.backgrounds?.length) return backgrounds;
    const existingIds = new Set(backgrounds.map((b) => b.id));
    return [...backgrounds, ...aiGeneratedData.backgrounds.filter((b) => !existingIds.has(b.id))];
  }, [backgrounds, aiGeneratedData]);

  // AI推荐选项ID集合（用于标记Badge）
  const aiRaceIds = useMemo(() => new Set(aiGeneratedData?.races?.map((r) => r.id) ?? []), [aiGeneratedData]);
  const aiClassIds = useMemo(() => new Set(aiGeneratedData?.classes?.map((c) => c.id) ?? []), [aiGeneratedData]);
  const aiBackgroundIds = useMemo(() => new Set(aiGeneratedData?.backgrounds?.map((b) => b.id) ?? []), [aiGeneratedData]);

  const availableClasses = useMemo(() => {
    if (!selectedRace || !templateData) return mergedClasses;
    const race = mergedRaces.find((r) => r.id === selectedRace);
    if (race?.available_classes && race.available_classes.length > 0) {
      return mergedClasses.filter((cls) => race.available_classes!.includes(cls.id));
    }
    return mergedClasses;
  }, [selectedRace, templateData, mergedRaces, mergedClasses]);

  useEffect(() => {
    if (selectedClass && availableClasses.length > 0 && !availableClasses.find((c) => c.id === selectedClass)) {
      setSelectedClass('');
    }
  }, [availableClasses, selectedClass]);

  const raceBonuses = useMemo(() => {
    const race = mergedRaces.find((r) => r.id === selectedRace);
    return race?.bonuses || {};
  }, [selectedRace, mergedRaces]);

  const racePenalties = useMemo(() => {
    const race = mergedRaces.find((r) => r.id === selectedRace);
    return race?.penalties || {};
  }, [selectedRace, mergedRaces]);

  const backgroundBonuses = useMemo(() => {
    const bg = mergedBackgrounds.find((b) => b.id === selectedBackground);
    return bg?.attribute_bonuses || {};
  }, [selectedBackground, mergedBackgrounds]);

  const ageBonuses = useMemo(() => {
    const ageGroups = templateData?.age_groups;
    if (!ageGroups || !selectedAgeGroup) return {};
    const ag = ageGroups.find((a) => a.id === selectedAgeGroup);
    return ag?.bonuses || {};
  }, [selectedAgeGroup, templateData]);

  const agePenalties = useMemo(() => {
    const ageGroups = templateData?.age_groups;
    if (!ageGroups || !selectedAgeGroup) return {};
    const ag = ageGroups.find((a) => a.id === selectedAgeGroup);
    return ag?.penalties || {};
  }, [selectedAgeGroup, templateData]);

  const usedPoints = useMemo(() => {
    return attributeDefs.reduce((sum, def) => {
      const current = attributes[def.id] ?? def.default_value;
      return sum + (current - def.default_value);
    }, 0);
  }, [attributes, attributeDefs]);

  const remainingPoints = totalPoints - usedPoints;

  // 触发AI选项生成（WS事件推送，无需轮询）
  const triggerAiGeneration = useCallback(async () => {
    if (!templateId || aiSessionId || aiGenerating) return;
    setAiGenerating(true);
    setAiOptionsStatus('pending');
    try {
      const result = await wsManager.sendRequest(WSRequestBuilder.template.generateOptions({ templateId }));
      const sessionId = (result as { session_id?: string }).session_id;
      if (sessionId) {
        setAiSessionId(sessionId);
      }
    } catch (err) {
      logger.error('CharacterCreate', 'Failed to trigger AI options generation', undefined, err instanceof Error ? err.stack : undefined);
      setAiOptionsStatus('failed');
      setAiGenerating(false);
    }
  }, [templateId, aiSessionId, aiGenerating]);

  // 监听 WS generate_progress 事件，替代 HTTP 轮询
  useEffect(() => {
    if (!aiSessionId || !templateId) return;

    const handleGenerateProgress = (message: import('@ai-rpg/shared').WSMessage) => {
      if (message.type !== 'game:event') return;
      const event = message as { eventType?: string; data?: { sessionId?: string; status?: string; type?: string; data?: GeneratedOptionsStatus['data']; error?: string } };
      if (event.eventType !== 'generate_progress') return;
      if (event.data?.sessionId !== aiSessionId) return;

      const status = event.data.status;
      if (status === 'completed' && event.data.data) {
        setAiGeneratedData(event.data.data);
        setAiOptionsStatus('completed');
        setAiGenerating(false);
      } else if (status === 'failed') {
        setAiOptionsStatus('failed');
        setAiGenerating(false);
      }
    };

    const unregister = wsManager.onMessage(handleGenerateProgress);
    return unregister;
  }, [aiSessionId, templateId]);

  // canNext 逻辑 - 基于步骤key
  const canNext = useMemo(() => {
    const stepKey = steps[currentStep]?.key;
    switch (stepKey) {
      case 'name': {
        const ageMode = templateData?.age_mode ?? 'group';
        const ageValid = ageMode === 'none' || (ageMode === 'group' ? !!selectedAgeGroup : !!ageNumber.trim());
        return !!name.trim() && !!selectedGender && (selectedGender !== 'custom' || !!customGenderText.trim()) && ageValid;
      }
      case 'race': return !!selectedRace;
      case 'class': return !!selectedClass;
      case 'background': return !!selectedBackground;
      case 'attributes': return remainingPoints >= 0;
      case 'custom': return true;
      case 'confirm': return !!name.trim();
      default: return false;
    }
  }, [currentStep, steps, selectedGender, customGenderText, selectedAgeGroup, ageNumber, templateData, name, selectedRace, selectedClass, selectedBackground, remainingPoints]);

  const handleAttributeChange = useCallback((attrId: string, delta: number) => {
    setAttributes((prev) => {
      const attrDef = attributeDefs.find((a) => a.id === attrId);
      const minVal = attrDef?.min_value ?? 1;
      const maxVal = attrDef?.max_value ?? 20;
      const current = prev[attrId] ?? minVal;
      const next = current + delta;
      if (next < minVal || next > maxVal) return prev;
      if (delta > 0 && remainingPoints <= 0) return prev;
      return { ...prev, [attrId]: next };
    });
  }, [attributeDefs, remainingPoints]);

  const handleCustomOptionChange = useCallback((optionId: string, value: string | number | boolean) => {
    setCustomOptions((prev) => ({ ...prev, [optionId]: value }));
  }, []);

  const handleCreate = async () => {
    if (!canNext || creating || !templateId) return;
    if (!isConnected) {
      setCreateError(t('wsNotConnected', { defaultValue: 'WS 连接未就绪，请刷新页面' }));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await initializeGame({
        templateId,
        characterData: {
          name: name.trim(),
          gender: selectedGender as Gender,
          customGender: selectedGender === 'custom' ? customGenderText.trim() : undefined,
          ageGroup: (templateData?.age_mode ?? 'group') === 'number' ? (ageNumber.trim() || undefined) : (selectedAgeGroup || undefined),
          race: selectedRace,
          classType: selectedClass,
          background: selectedBackground,
          attributes,
          customOptions: hasCustomOptions ? customOptions : undefined,
        },
        language: useSettingsStore.getState().language,
      });
      // 不需要 navigate，useEffect 会在 initState='done' 时跳转
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('createFailed');
      setCreateError(errorMsg);
      setCreating(false);
    }
  };

  const handleRetry = useCallback(() => {
    setCreating(false);
    setCreateError(null);
  }, []);

  const selectedRaceData = mergedRaces.find((r) => r.id === selectedRace);
  const selectedClassData = mergedClasses.find((c) => c.id === selectedClass);
  const selectedBackgroundData = mergedBackgrounds.find((b) => b.id === selectedBackground);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--accent)] border-t-transparent" />
          <p className="text-sm text-[var(--text-muted)]">{t('loadingOptions')}</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-[var(--error)]">{loadError}</p>
          <button
            onClick={() => navigate('/select-template')}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white hover:bg-[var(--accent-hover)]"
          >
            {t('reselectTemplate')}
          </button>
        </div>
      </div>
    );
  }

  // 获取当前步骤key
  const currentStepKey = steps[currentStep]?.key;

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden p-2 sm:p-4">
      <motion.div
        className="flex w-full max-w-3xl flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 shadow-lg sm:p-6 max-h-full"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="mb-2 flex shrink-0 items-center gap-2 sm:mb-4">
          <button
            onClick={() => navigate('/select-template')}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)]"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="font-game text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            {t('title')}
          </h1>
        </div>

        <div className="mb-2 flex shrink-0 items-center justify-center gap-1.5 sm:mb-4">
          {steps.map((step, i) => (
            <div key={step.key} className="flex items-center">
              <div
                className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  i < currentStep
                    ? 'bg-[var(--accent)] text-white'
                    : i === currentStep
                    ? 'border-2 border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                }`}
              >
                {i < currentStep ? <CheckIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mx-0.5 sm:mx-1 h-0.5 w-4 sm:w-6 transition-colors ${
                    i < currentStep ? 'bg-[var(--accent)]' : 'bg-[var(--border-secondary)]'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="mb-1 shrink-0 text-center text-xs sm:text-sm font-medium text-[var(--text-secondary)]">
          {t(steps[currentStep]?.labelKey as string)}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={creating ? 'init-progress' : currentStepKey}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            {creating ? (
              <InitProgressTree tree={storeInitProgressTree} onRetry={handleRetry} />
            ) : (
              <>
            {currentStepKey === 'name' && (
              <NameStep
                name={name}
                onNameChange={setName}
                selectedGender={selectedGender}
                onSelectGender={setSelectedGender}
                customGenderText={customGenderText}
                onCustomGenderChange={setCustomGenderText}
                selectedAgeGroup={selectedAgeGroup}
                onSelectAgeGroup={setSelectedAgeGroup}
                ageMode={templateData?.age_mode ?? 'group'}
                ageGroups={templateData?.age_groups}
                ageNumberConfig={templateData?.age_number}
                ageNumber={ageNumber}
                onAgeNumberChange={setAgeNumber}
                aiGenerateOptions={aiGenerateOptions}
                aiGenerating={aiGenerating}
                aiOptionsStatus={aiOptionsStatus}
                onTriggerAiGeneration={triggerAiGeneration}
              />
            )}

            {currentStepKey === 'race' && (
              <RaceStep
                races={mergedRaces}
                selectedRace={selectedRace}
                onSelect={setSelectedRace}
                attributeNameMap={attributeNameMap}
                aiRaceIds={aiRaceIds}
                aiOptionsStatus={aiOptionsStatus}
              />
            )}

            {currentStepKey === 'class' && (
              <ClassStep
                classes={availableClasses}
                selectedClass={selectedClass}
                onSelect={setSelectedClass}
                selectedRaceName={selectedRaceData?.name}
                attributeNameMap={attributeNameMap}
                aiClassIds={aiClassIds}
                aiOptionsStatus={aiOptionsStatus}
              />
            )}

            {currentStepKey === 'background' && (
              <BackgroundStep
                backgrounds={mergedBackgrounds}
                selectedBackground={selectedBackground}
                onSelect={setSelectedBackground}
                aiBackgroundIds={aiBackgroundIds}
                aiOptionsStatus={aiOptionsStatus}
              />
            )}

            {currentStepKey === 'attributes' && (
              <AttributesStep
                attributeDefs={attributeDefs}
                attributes={attributes}
                raceBonuses={raceBonuses}
                racePenalties={racePenalties}
                backgroundBonuses={backgroundBonuses}
                ageBonuses={ageBonuses}
                agePenalties={agePenalties}
                remainingPoints={remainingPoints}
                totalPoints={totalPoints}
                selectedRaceName={selectedRaceData?.name}
                onAttributeChange={handleAttributeChange}
                attributeNameMap={attributeNameMap}
              />
            )}

            {currentStepKey === 'custom' && (
              <CustomOptionsStep
                customOptions={customOptionsList}
                values={customOptions}
                onChange={handleCustomOptionChange}
              />
            )}

            {currentStepKey === 'confirm' && (
              <ConfirmStep
                name={name}
                selectedGender={selectedGender}
                customGenderText={customGenderText}
                selectedAgeGroup={selectedAgeGroup}
                ageMode={templateData?.age_mode ?? 'group'}
                ageNumber={ageNumber}
                ageGroups={templateData?.age_groups}
                selectedRaceData={selectedRaceData}
                selectedClassData={selectedClassData}
                selectedBackgroundData={selectedBackgroundData}
                attributeDefs={attributeDefs}
                attributes={attributes}
                raceBonuses={raceBonuses}
                backgroundBonuses={backgroundBonuses}
                ageBonuses={ageBonuses}
                agePenalties={agePenalties}
                customOptionsList={customOptionsList}
                customOptionsValues={customOptions}
                createError={createError}
              />
            )}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-3 flex shrink-0 items-center justify-between border-t border-[var(--border-primary)] pt-3 sm:mt-4 sm:pt-4">
          {!creating && (
          <button
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-1 rounded-md border border-[var(--border-primary)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] disabled:opacity-30"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t('common:previous')}
          </button>
          )}
          {creating && <div />}

          {currentStep < steps.length - 1 ? (
            <button
              onClick={() => setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
              disabled={!canNext}
              className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common:next')}
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!canNext || creating || !isConnected}
              className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('creating')}
                </span>
              ) : !isConnected ? (
                t('connecting', { defaultValue: '连接中...' })
              ) : (
                <>
                  {t('startAdventure')}
                  <CheckIcon className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ==================== NameStep（含性别选择） ====================

const GENDER_OPTIONS: { value: Gender; icon: string; color: string }[] = [
  { value: 'male', icon: '♂', color: 'var(--accent)' },
  { value: 'female', icon: '♀', color: 'var(--error)' },
  { value: 'custom', icon: '✦', color: 'var(--experience)' },
];

const AGE_GROUP_ICONS: Record<string, { icon: string; color: string }> = {
  young: { icon: '🌱', color: 'var(--success)' },
  youth: { icon: '⚔️', color: 'var(--accent)' },
  middle: { icon: '🛡️', color: 'var(--warning)' },
  elder: { icon: '📜', color: 'var(--experience)' },
};

function NameStep({
  name,
  onNameChange,
  selectedGender,
  onSelectGender,
  customGenderText,
  onCustomGenderChange,
  selectedAgeGroup,
  onSelectAgeGroup,
  ageMode,
  ageGroups,
  ageNumberConfig,
  ageNumber,
  onAgeNumberChange,
  aiGenerateOptions,
  aiGenerating,
  aiOptionsStatus,
  onTriggerAiGeneration,
}: {
  name: string;
  onNameChange: (v: string) => void;
  selectedGender: Gender | '';
  onSelectGender: (g: Gender) => void;
  customGenderText: string;
  onCustomGenderChange: (v: string) => void;
  selectedAgeGroup: AgeGroup | '';
  onSelectAgeGroup: (a: AgeGroup) => void;
  ageMode: AgeMode;
  ageGroups?: AgeGroupDefinition[];
  ageNumberConfig?: AgeNumberConfig;
  ageNumber: string;
  onAgeNumberChange: (v: string) => void;
  aiGenerateOptions: boolean;
  aiGenerating: boolean;
  aiOptionsStatus: 'idle' | 'pending' | 'completed' | 'failed' | 'expired';
  onTriggerAiGeneration: () => void;
}) {
  const { t } = useTranslation('character');
  const [hasTriggered, setHasTriggered] = useState(false);

  const handleNameBlur = useCallback(() => {
    if (aiGenerateOptions && name.trim() && !hasTriggered && aiOptionsStatus === 'idle') {
      setHasTriggered(true);
      onTriggerAiGeneration();
    }
  }, [aiGenerateOptions, name, hasTriggered, aiOptionsStatus, onTriggerAiGeneration]);

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
          {t('characterName')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={handleNameBlur}
          placeholder={t('characterNamePlaceholder')}
          maxLength={30}
          className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t('characterNameHint')}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
          {t('gender')}
        </label>
        <div className="grid grid-cols-3 gap-3 pb-2">
          {GENDER_OPTIONS.map((opt) => (
            <motion.button
              key={opt.value}
              onClick={() => onSelectGender(opt.value)}
              className={`rounded-lg border p-4 text-left transition-all ${
                selectedGender === opt.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-[var(--glow-accent)]'
                  : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-secondary)]'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xl"
                  style={{ color: selectedGender === opt.value ? opt.color : 'var(--text-muted)' }}
                >
                  {opt.icon}
                </span>
                <h3 className={`font-game text-base font-bold ${
                  selectedGender === opt.value ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'
                }`}>
                  {GENDER_LABELS[opt.value]}
                </h3>
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                {opt.value === 'male' ? t('genderDesc.male') : opt.value === 'female' ? t('genderDesc.female') : t('genderDesc.custom')}
              </p>
            </motion.button>
          ))}
        </div>
        <AnimatePresence>
          {selectedGender === 'custom' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <input
                type="text"
                value={customGenderText}
                onChange={(e) => onCustomGenderChange(e.target.value)}
                placeholder={t('customGenderPlaceholder')}
                maxLength={20}
                className="mt-3 w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {ageMode === 'group' && ageGroups && ageGroups.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
            {t('ageGroup')}
          </label>
          <div className={`grid gap-3 pb-2 ${ageGroups.length <= 2 ? 'grid-cols-2' : ageGroups.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
            {ageGroups.map((def) => {
              const styling = AGE_GROUP_ICONS[def.id] ?? { icon: '👤', color: 'var(--accent)' };
              const label = def.name || DEFAULT_AGE_GROUP_LABELS[def.id] || def.id;
              const desc = def.description || t(`ageGroupDesc.${def.id}`);
              return (
                <motion.button
                  key={def.id}
                  onClick={() => onSelectAgeGroup(def.id)}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    selectedAgeGroup === def.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-[var(--glow-accent)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-secondary)]'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xl"
                      style={{ color: selectedAgeGroup === def.id ? styling.color : 'var(--text-muted)' }}
                    >
                      {styling.icon}
                    </span>
                    <h3 className={`font-game text-base font-bold ${
                      selectedAgeGroup === def.id ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'
                    }`}>
                      {label}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    {desc}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {ageMode === 'number' && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
            {t('ageGroup')}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={ageNumber}
              onChange={(e) => onAgeNumberChange(e.target.value)}
              min={ageNumberConfig?.min ?? 1}
              max={ageNumberConfig?.max ?? 999}
              placeholder={String(ageNumberConfig?.default ?? ageNumberConfig?.min ?? 18)}
              className="w-32 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            />
            <span className="text-xs text-[var(--text-muted)]">
              {ageNumberConfig ? `${ageNumberConfig.min} ~ ${ageNumberConfig.max}` : ''}
            </span>
          </div>
        </div>
      )}

      {aiGenerateOptions && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-[var(--accent)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">{t('aiGeneration.title')}</span>
          </div>
          {aiOptionsStatus === 'idle' && !aiGenerating && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {t('aiGeneration.idleHint')}
            </p>
          )}
          {aiOptionsStatus === 'pending' && aiGenerating && (
            <div className="mt-2 flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              <span className="text-xs text-[var(--text-secondary)]">{t('aiGeneration.pending')}</span>
            </div>
          )}
          {aiOptionsStatus === 'completed' && (
            <p className="mt-2 text-xs font-medium text-[var(--success)]">
              {t('aiGeneration.completed')}
            </p>
          )}
          {aiOptionsStatus === 'failed' && (
            <p className="mt-2 text-xs text-[var(--error)]">
              {t('aiGeneration.failed')}
            </p>
          )}
          {aiOptionsStatus === 'expired' && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {t('aiGeneration.expired')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== AI推荐Badge ====================

function AiRecommendBadge() {
  const { t } = useTranslation('character');
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
      <SparklesIcon className="h-3 w-3" />
      {t('aiRecommend')}
    </span>
  );
}

// ==================== RaceStep ====================

function RaceStep({
  races,
  selectedRace,
  onSelect,
  attributeNameMap,
  aiRaceIds,
  aiOptionsStatus,
}: {
  races: RaceDefinition[];
  selectedRace: string;
  onSelect: (id: string) => void;
  attributeNameMap: Record<string, string>;
  aiRaceIds: Set<string>;
  aiOptionsStatus: 'idle' | 'pending' | 'completed' | 'failed' | 'expired';
}) {
  const { t } = useTranslation('character');
  return (
    <div>
      {aiOptionsStatus === 'pending' && (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)]/5 px-3 py-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <span className="text-xs text-[var(--text-secondary)]">{t('aiGeneration.generating')}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pb-2">
        {races.map((race) => (
          <motion.button
            key={race.id}
            onClick={() => onSelect(race.id)}
            className={`rounded-lg border p-4 text-left transition-all ${
              selectedRace === race.id
                ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-[var(--glow-accent)]'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-secondary)]'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center">
              <h3 className="font-game text-base font-bold text-[var(--text-primary)]">
                {race.name}
              </h3>
              {aiRaceIds.has(race.id) && <AiRecommendBadge />}
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
              {race.description}
            </p>
            {Object.keys(race.bonuses).length > 0 && (
              <p className="mt-2 text-xs font-medium text-[var(--success)]">
                {t('bonuses')}{formatBonuses(race.bonuses, attributeNameMap)}
              </p>
            )}
            {Object.keys(race.penalties).filter((k) => race.penalties[k] < 0).length > 0 && (
              <p className="mt-1 text-xs font-medium text-[var(--error)]">
                {t('penalties')}{formatPenalties(race.penalties, attributeNameMap)}
              </p>
            )}
            {race.abilities && race.abilities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {race.abilities.map((ability) => (
                  <span
                    key={ability}
                    className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                  >
                    {ability}
                  </span>
                ))}
              </div>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ==================== ClassStep ====================

function ClassStep({
  classes,
  selectedClass,
  onSelect,
  selectedRaceName,
  attributeNameMap,
  aiClassIds,
  aiOptionsStatus,
}: {
  classes: ClassDefinition[];
  selectedClass: string;
  onSelect: (id: string) => void;
  selectedRaceName?: string;
  attributeNameMap: Record<string, string>;
  aiClassIds: Set<string>;
  aiOptionsStatus: 'idle' | 'pending' | 'completed' | 'failed' | 'expired';
}) {
  const { t } = useTranslation('character');
  return (
    <div>
      {aiOptionsStatus === 'pending' && (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)]/5 px-3 py-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <span className="text-xs text-[var(--text-secondary)]">{t('aiGeneration.generating')}</span>
        </div>
      )}
      {selectedRaceName && (
        <p className="mb-3 text-center text-xs text-[var(--text-muted)]">
          <span className="font-medium" style={{ color: 'var(--accent)' }}>{selectedRaceName}</span>
          {t('availableClasses')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pb-2">
        {classes.map((cls) => (
          <motion.button
            key={cls.id}
            onClick={() => onSelect(cls.id)}
            className={`rounded-lg border p-4 text-left transition-all ${
              selectedClass === cls.id
                ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-[var(--glow-accent)]'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-secondary)]'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center">
              <h3 className="font-game text-base font-bold text-[var(--text-primary)]">
                {cls.name}
              </h3>
              {aiClassIds.has(cls.id) && <AiRecommendBadge />}
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
              {cls.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
              {cls.hit_die && (
                <span>{t('hitDie')}<span className="font-medium text-[var(--accent)]">{cls.hit_die}</span></span>
              )}
              {cls.primary_attributes && cls.primary_attributes.length > 0 && (
                <span>{t('primaryAttributes')}<span className="font-medium text-[var(--accent)]">{cls.primary_attributes.map((a) => attributeNameMap[a] || a.toUpperCase()).join('、')}</span></span>
              )}
            </div>
            {cls.skill_proficiencies && cls.skill_proficiencies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {cls.skill_proficiencies.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ==================== BackgroundStep ====================

function BackgroundStep({
  backgrounds,
  selectedBackground,
  onSelect,
  aiBackgroundIds,
  aiOptionsStatus,
}: {
  backgrounds: BackgroundDefinition[];
  selectedBackground: string;
  onSelect: (id: string) => void;
  aiBackgroundIds: Set<string>;
  aiOptionsStatus: 'idle' | 'pending' | 'completed' | 'failed' | 'expired';
}) {
  const { t } = useTranslation('character');
  return (
    <div>
      {aiOptionsStatus === 'pending' && (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)]/5 px-3 py-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <span className="text-xs text-[var(--text-secondary)]">{t('aiGeneration.generating')}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pb-2">
        {backgrounds.map((bg) => (
          <motion.button
            key={bg.id}
            onClick={() => onSelect(bg.id)}
            className={`rounded-lg border p-4 text-left transition-all ${
              selectedBackground === bg.id
                ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-[var(--glow-accent)]'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-secondary)]'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center">
              <h3 className="font-game text-base font-bold text-[var(--text-primary)]">
                {bg.name}
              </h3>
              {aiBackgroundIds.has(bg.id) && <AiRecommendBadge />}
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
              {bg.description}
            </p>
            {bg.feature && (
              <p className="mt-2 text-xs font-medium text-[var(--accent)]">
                {t('feature')}{bg.feature}
              </p>
            )}
            {bg.skill_proficiencies && bg.skill_proficiencies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {bg.skill_proficiencies.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
            {bg.languages && bg.languages.length > 0 && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t('languages')}{bg.languages.join('、')}
              </p>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ==================== AttributesStep (unchanged) ====================

function AttributesStep({
  attributeDefs,
  attributes,
  raceBonuses,
  racePenalties,
  backgroundBonuses,
  ageBonuses,
  agePenalties,
  remainingPoints,
  totalPoints,
  selectedRaceName,
  onAttributeChange,
  attributeNameMap,
}: {
  attributeDefs: AttributeDefinition[];
  attributes: Record<string, number>;
  raceBonuses: Record<string, number>;
  racePenalties: Record<string, number>;
  backgroundBonuses: Record<string, number>;
  ageBonuses: Record<string, number>;
  agePenalties: Record<string, number>;
  remainingPoints: number;
  totalPoints: number;
  selectedRaceName?: string;
  onAttributeChange: (attrId: string, delta: number) => void;
  attributeNameMap: Record<string, string>;
}) {
  const { t } = useTranslation('character');
  return (
    <div>
      <div className="mb-3 flex items-center justify-between rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-secondary)]">{t('attributePoints')}</span>
          <span className="text-xs text-[var(--text-muted)]">({t('total')}: {totalPoints})</span>
        </div>
        <span
          className={`font-mono text-lg font-bold ${
            remainingPoints === 0
              ? 'text-[var(--success)]'
              : remainingPoints < 0
              ? 'text-[var(--error)]'
              : 'text-[var(--accent)]'
          }`}
        >
          {remainingPoints}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {attributeDefs.map((attrDef) => {
          const color = getAttributeColor(attrDef.id);
          const raceBonus = raceBonuses[attrDef.id] || 0;
          const racePenalty = racePenalties[attrDef.id] || 0;
          const bgBonus = backgroundBonuses[attrDef.id] || 0;
          const ageBonus = ageBonuses[attrDef.id] || 0;
          const agePenalty = agePenalties[attrDef.id] || 0;
          const totalBonus = raceBonus + racePenalty + bgBonus + ageBonus + agePenalty;
          const baseVal = attributes[attrDef.id] ?? attrDef.default_value;
          const total = baseVal + totalBonus;
          const pct = ((baseVal - attrDef.min_value) / (attrDef.max_value - attrDef.min_value)) * 100;
          const minVal = attrDef.min_value;
          const maxVal = attrDef.max_value;
          return (
            <div
              key={attrDef.id}
              className="relative flex flex-col rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-2.5 shadow-sm"
            >
              {totalBonus !== 0 && (
                <div
                  className="absolute top-0.5 right-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm"
                  style={{ backgroundColor: totalBonus > 0 ? color : 'var(--error)' }}
                >
                  {totalBonus > 0 ? '+' : ''}{totalBonus}
                </div>
              )}

              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-bold truncate" style={{ color }}>
                  {attrDef.name}
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-lg font-extrabold text-[var(--text-primary)]">
                    {total}
                  </span>
                  {totalBonus !== 0 && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      ({baseVal}{totalBonus > 0 ? '+' : ''}{totalBonus})
                    </span>
                  )}
                </div>
              </div>

              <div className="relative mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-primary)]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                  initial={false}
                  animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                />
              </div>

              <div className="mt-1.5 flex items-center justify-end gap-1">
                <button
                  onClick={() => onAttributeChange(attrDef.id, -1)}
                  disabled={baseVal <= minVal}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-30"
                >
                  −
                </button>
                <button
                  onClick={() => onAttributeChange(attrDef.id, 1)}
                  disabled={baseVal >= maxVal || remainingPoints <= 0}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedRaceName && (Object.keys(raceBonuses).length > 0 || Object.keys(racePenalties).length > 0) && (
        <div className="mt-2 rounded-lg border border-dashed border-[var(--border-secondary)] bg-[var(--bg-secondary)]/50 px-3 py-1.5 text-center">
          <span className="text-xs text-[var(--text-muted)]">
            {t('raceBonuses', { raceName: selectedRaceName })}：
            {Object.keys(raceBonuses).length > 0 && (
              <span className="font-medium text-[var(--success)]"> {formatBonuses(raceBonuses, attributeNameMap)}</span>
            )}
            {Object.keys(racePenalties).filter((k) => racePenalties[k] < 0).length > 0 && (
              <span className="font-medium text-[var(--error)]"> {formatPenalties(racePenalties, attributeNameMap)}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ==================== CustomOptionsStep ====================

function CustomOptionsStep({
  customOptions,
  values,
  onChange,
}: {
  customOptions: CustomOption[];
  values: Record<string, string | number | boolean>;
  onChange: (optionId: string, value: string | number | boolean) => void;
}) {
  const { t } = useTranslation('character');
  if (customOptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
        <p className="text-sm">{t('noCustomOptions')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {customOptions.map((opt) => (
        <div key={opt.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              {opt.name}
            </label>
          </div>
          {opt.description && (
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              {opt.description}
            </p>
          )}

          {opt.type === 'text' && (
            <input
              type="text"
              value={typeof values[opt.id] === 'string' ? values[opt.id] as string : ''}
              onChange={(e) => onChange(opt.id, e.target.value)}
              placeholder={t('inputPlaceholder', { name: opt.name })}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            />
          )}

          {opt.type === 'select' && (
            <select
              value={typeof values[opt.id] === 'string' ? values[opt.id] as string : ''}
              onChange={(e) => onChange(opt.id, e.target.value)}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            >
              <option value="">{t('pleaseSelect')}</option>
              {opt.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}

          {opt.type === 'number' && (
            <input
              type="number"
              value={typeof values[opt.id] === 'number' ? values[opt.id] as number : 0}
              onChange={(e) => onChange(opt.id, Number(e.target.value) || 0)}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            />
          )}

          {opt.type === 'boolean' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={values[opt.id] === true}
                onClick={() => onChange(opt.id, values[opt.id] !== true)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 ${
                  values[opt.id] === true ? 'bg-[var(--accent)]' : 'bg-[var(--border-secondary)]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    values[opt.id] === true ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm text-[var(--text-secondary)]">
                {values[opt.id] === true ? t('common:yes') : t('common:no')}
              </span>
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

// ==================== ConfirmStep ====================

function ConfirmStep({
  name,
  selectedGender,
  customGenderText,
  selectedAgeGroup,
  ageMode,
  ageNumber,
  ageGroups,
  selectedRaceData,
  selectedClassData,
  selectedBackgroundData,
  attributeDefs,
  attributes,
  raceBonuses,
  backgroundBonuses,
  ageBonuses,
  agePenalties,
  customOptionsList,
  customOptionsValues,
  createError,
}: {
  name: string;
  selectedGender: Gender | '';
  customGenderText: string;
  selectedAgeGroup: AgeGroup | '';
  ageMode: AgeMode;
  ageNumber: string;
  ageGroups?: AgeGroupDefinition[];
  selectedRaceData?: RaceDefinition;
  selectedClassData?: ClassDefinition;
  selectedBackgroundData?: BackgroundDefinition;
  attributeDefs: AttributeDefinition[];
  attributes: Record<string, number>;
  raceBonuses: Record<string, number>;
  backgroundBonuses: Record<string, number>;
  ageBonuses: Record<string, number>;
  agePenalties: Record<string, number>;
  customOptionsList: CustomOption[];
  customOptionsValues: Record<string, string | number | boolean>;
  createError?: string | null;
}) {
  const { t } = useTranslation('character');
  return (
    <div className="space-y-6">
      {createError && (
        <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3">
          <p className="text-sm font-medium text-[var(--error)]">{createError}</p>
        </div>
      )}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
        <h3 className="mb-4 font-game text-base font-bold text-[var(--text-primary)]">
          {t('characterOverview')}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t('common:name')}</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {name.trim() || '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t('gender')}</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedGender === 'custom' ? customGenderText || '-' : selectedGender ? GENDER_LABELS[selectedGender] : '-'}
            </p>
          </div>
          {ageMode !== 'none' && (
            <div>
              <p className="text-xs text-[var(--text-muted)]">{t('ageGroup')}</p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {ageMode === 'number'
                  ? (ageNumber.trim() || '-')
                  : (selectedAgeGroup ? (ageGroups?.find(a => a.id === selectedAgeGroup)?.name || DEFAULT_AGE_GROUP_LABELS[selectedAgeGroup] || selectedAgeGroup) : '-')}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t('race')}</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedRaceData?.name || '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t('classType')}</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedClassData?.name || '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t('selectBackground')}</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {selectedBackgroundData?.name || '-'}
            </p>
          </div>
        </div>
        <div className="mt-4 border-t border-[var(--border-primary)] pt-4">
          <p className="mb-2 text-xs text-[var(--text-muted)]">{t('game:character.attributes')}</p>
          <div className="flex gap-4">
            {attributeDefs.map((attrDef) => {
              const color = getAttributeColor(attrDef.id);
              const raceBonus = raceBonuses[attrDef.id] || 0;
              const bgBonus = backgroundBonuses[attrDef.id] || 0;
              const ageBonus = ageBonuses[attrDef.id] || 0;
              const agePenalty = agePenalties[attrDef.id] || 0;
              const total = (attributes[attrDef.id] ?? attrDef.default_value) + raceBonus + bgBonus + ageBonus + agePenalty;
              return (
                <div key={attrDef.id} className="text-center">
                  <p className="text-xs" style={{ color }}>
                    {attrDef.name}
                  </p>
                  <p className="font-mono text-sm font-bold text-[var(--text-primary)]">
                    {total}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        {/* 自定义选项汇总 */}
        {customOptionsList.length > 0 && (
          <div className="mt-4 border-t border-[var(--border-primary)] pt-4">
            <p className="mb-2 text-xs text-[var(--text-muted)]">{t('customOptions')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {customOptionsList.map((opt) => {
                const value = customOptionsValues[opt.id];
                const displayValue = opt.type === 'boolean'
                  ? (value === true ? t('common:yes') : t('common:no'))
                  : String(value ?? opt.default_value);
                return (
                  <div key={opt.id}>
                    <p className="text-xs text-[var(--text-muted)]">{opt.name}</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {displayValue || '-'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
