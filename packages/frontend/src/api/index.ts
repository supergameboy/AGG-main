export { apiClient, llmClient } from './client';
export { saveApi } from './saveApi';
export { gameApi } from './gameApi';
export { templateApi } from './templateApi';
export { configApi } from './configApi';
export { parseApiError, getUserMessage, isInputBlocked, isNotFoundError, isTimeoutError, isNetworkError } from './errorHandler';
export type { ApiErrorDetail, ErrorCategory } from './errorHandler';

export type { SaveRecord, CompleteSaveData, SnapshotRecord, ListSavesParams } from './saveApi';
export type { InitGameParams, InitGameResponse, ChatParams, ChatResult, ChatResponse, CharacterData, AgentStatusInfo, DecisionLogQuery, DecisionLogResult, HealthCheckResult, InitStepResult, GmInfo } from './gameApi';
export type { TemplateValidationResult, TemplateExportData, CharacterOptionsResponse, GameConfigResponse } from './templateApi';
export type { CreateAgentProfileParams, ReloadConfigParams, ReloadConfigResult, ReactTestParams } from './configApi';
