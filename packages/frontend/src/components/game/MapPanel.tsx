import { useState, useMemo, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactFlowProvider } from '@xyflow/react';
import { LockClosedIcon, MapIcon, ListBulletIcon, GlobeAltIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { MapFlowInner } from './map-flow/MapFlowInner';
import { aggregateRegionConnections } from './map-flow/aggregateRegionConnections';
import { resolveMapLocationDisplay } from '@/utils/customDataResolver';
import { useMapStore, selectMaps, selectRegions, selectCurrentRegion, selectCurrentRegionChildren, selectCurrentMap } from '@/stores/mapStore';
import { useGameStore } from '../../stores/gameStore';
import { getLocationTypeConfig } from './map-constants';
import type { FrontendMapLocation } from '@/types';

type Location = FrontendMapLocation;

interface MapPanelProps {
  className?: string;
}

function getTypeBadge(type: string | undefined, t: (key: string) => string) {
  if (!type) return null;
  const config = getLocationTypeConfig(type);
  const labelKey = `map.type.${type}`;
  const translated = t(labelKey);
  const label = translated === labelKey ? type : translated;
  return { config, label };
}

export const MapPanel = memo(function MapPanel({
  className,
}: MapPanelProps) {
  const { t } = useTranslation('game');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<'map' | 'list'>('map');
  const [npcPanelExpanded, setNpcPanelExpanded] = useState(true);

  const locations = useMapStore((s) => s.mapState.locations);
  const connections = useMapStore((s) => s.mapState.connections);
  const discoveredLocationIds = useMapStore((s) => s.mapState.discoveredLocationIds);
  const viewMode = useMapStore((s) => s.mapState.viewMode ?? 'world');
  const selectedMapId = useMapStore((s) => s.mapState.selectedMapId);
  const selectMapAction = useMapStore((s) => s.selectMap);
  const setViewModeAction = useMapStore((s) => s.setViewMode);

  const mapLocations = useMapStore(selectMaps);
  const currentMap = useMapStore(selectCurrentMap);
  const currentRegion = useMapStore(selectCurrentRegion);
  const currentRegionChildren = useMapStore(selectCurrentRegionChildren);
  const npcInfoList = useGameStore((s) => s.npcInfoList);

  const regionsForSelectedMap = useMapStore(
    useCallback((s) => selectRegions(s, selectedMapId ?? undefined), [selectedMapId])
  );

  const isDiscovered = (loc: Location) =>
    loc.discovered === true || discoveredLocationIds.includes(loc.id);

  const npcNamesInCurrentRegion = useMemo(() => {
    return npcInfoList
      .filter(npc => {
        const npcLocId = npc.locationId;
        if (!npcLocId) return false;
        if (currentRegion?.id === npcLocId) return true;
        return currentRegionChildren.some(child => child.id === npcLocId);
      })
      .map(npc => npc.name || npc.id);
  }, [currentRegion, currentRegionChildren, npcInfoList]);

  const regionConnections = useMemo(
    () => aggregateRegionConnections(connections, locations),
    [connections, locations],
  );

  const selectedMapRegionConnections = useMemo(() => {
    const regionIds = new Set(regionsForSelectedMap.map((r) => r.id));
    return connections.filter(
      (c) => regionIds.has(c.from) || regionIds.has(c.to)
    );
  }, [connections, regionsForSelectedMap]);

  const connectedRegions = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const conn of regionConnections) {
      if (!result[conn.from]) result[conn.from] = [];
      if (!result[conn.from].includes(conn.to)) result[conn.from].push(conn.to);
      if (conn.connectionType !== 'one_way') {
        if (!result[conn.to]) result[conn.to] = [];
        if (!result[conn.to].includes(conn.from)) result[conn.to].push(conn.from);
      }
    }
    return result;
  }, [regionConnections]);

  const getConnectionsForRegion = (regionId: string) => {
    const ids = connectedRegions[regionId] ?? [];
    return ids
      .map((id) => regionsForSelectedMap.find((l) => l.id === id))
      .filter((l): l is Location => l !== undefined);
  };

  const getConnectionInfo = (fromId: string, toId: string) => {
    return regionConnections.find(
      (c) =>
        (c.from === fromId && c.to === toId) ||
        (c.connectionType !== 'one_way' && c.from === toId && c.to === fromId)
    );
  };

  const handleNodeClick = useCallback((locationId: string) => {
    setSelectedId(prev => prev === locationId ? null : locationId);
  }, []);

  const handleMapCardClick = useCallback((mapId: string) => {
    selectMapAction(mapId);
    setViewModeAction('region');
    setSelectedId(null);
  }, [selectMapAction, setViewModeAction]);

  const handleBackToWorld = useCallback(() => {
    setViewModeAction('world');
    selectMapAction(null);
    setSelectedId(null);
  }, [setViewModeAction, selectMapAction]);

  const discoveredRegionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const loc of regionsForSelectedMap) {
      if (isDiscovered(loc)) ids.add(loc.id);
    }
    for (const id of discoveredLocationIds) {
      const loc = locations.find((l) => l.id === id);
      if (loc && loc.locationLevel === 2) ids.add(id);
    }
    return Array.from(ids);
  }, [regionsForSelectedMap, discoveredLocationIds, locations]);

  // ============================================================
  // 世界地图视图
  // ============================================================
  const renderWorldView = () => (
    <div className="flex flex-col gap-3">
      {mapLocations.length === 0 && (
        <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
          {t('map.noLocationData')}
        </div>
      )}
      <div className={cn(
        'grid gap-2.5',
        mapLocations.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
      )}>
        {mapLocations.map((mapLoc) => {
          const isCurrentMap = currentMap?.id === mapLoc.id;
          const regionCount = locations.filter(
            (l) => l.parentLocationId === mapLoc.id && l.locationLevel === 2
          ).length;
          const badge = getTypeBadge(mapLoc.type, t);

          return (
            <Card
              key={mapLoc.id}
              variant="default"
              padding="sm"
              hoverable
              onClick={() => handleMapCardClick(mapLoc.id)}
              className={cn(
                'cursor-pointer transition-all',
                isCurrentMap && 'border-[var(--accent)] bg-[var(--accent)]/5'
              )}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <Tooltip content={mapLoc.name}>
                      <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {mapLoc.name}
                      </h4>
                    </Tooltip>
                    {badge && (
                      <Badge customColor={badge.config.bgColor} size="sm">
                        {badge.label}
                      </Badge>
                    )}
                    {isCurrentMap && (
                      <Badge variant="info" size="sm">{t('map.currentlyAt')}</Badge>
                    )}
                  </div>
                  {mapLoc.description && (
                    <Tooltip content={mapLoc.description} multiline>
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                        {mapLoc.description}
                      </p>
                    </Tooltip>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    {regionCount > 0 && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {regionCount} {t('map.regions') ?? '区域'}
                      </span>
                    )}
                    <ChevronRightIcon className="h-3 w-3 text-[var(--text-muted)] ml-auto" />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );

  // ============================================================
  // 区域视图（增强版）
  // ============================================================
  const renderRegionView = () => {
    const selectedMapLoc = locations.find((l) => l.id === selectedMapId);

    return (
      <>
        {/* 面包屑导航 */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={handleBackToWorld}
            className="text-[var(--accent)] hover:underline cursor-pointer"
          >
            {t('map.worldMap') ?? '世界地图'}
          </button>
          {selectedMapLoc && (
            <>
              <ChevronRightIcon className="h-3 w-3 text-[var(--text-muted)]" />
              <span className="text-[var(--text-primary)] font-medium truncate max-w-[120px]">
                {selectedMapLoc.name}
              </span>
            </>
          )}
        </div>

        {/* 地图/列表切换 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Button
              variant={displayMode === 'map' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setDisplayMode('map')}
            >
              <MapIcon className="h-3.5 w-3.5 mr-1" />
              {t('map.viewMap')}
            </Button>
            <Button
              variant={displayMode === 'list' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setDisplayMode('list')}
            >
              <ListBulletIcon className="h-3.5 w-3.5 mr-1" />
              {t('map.viewList')}
            </Button>
          </div>
          {currentRegion && (
            <Tooltip content={currentRegion.name}>
              <span className="text-xs text-[var(--accent)] font-medium truncate max-w-[120px]">
                📍 {currentRegion.name}
              </span>
            </Tooltip>
          )}
        </div>

        {displayMode === 'map' && regionsForSelectedMap.length > 0 && (
          <div className="relative" style={{ height: '400px' }}>
            <ReactFlowProvider>
              <MapFlowInner
                locations={regionsForSelectedMap}
                connections={selectedMapRegionConnections}
                currentLocationId={currentRegion?.id}
                discoveredLocationIds={discoveredRegionIds}
                selectedId={selectedId}
                onNodeClick={handleNodeClick}
                regionOnly
              />
            </ReactFlowProvider>
          </div>
        )}

        {displayMode === 'map' && regionsForSelectedMap.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
            {t('map.noLocationData')}
          </div>
        )}

        {currentRegion && (
          <Card variant="bordered" padding="sm" borderColor="var(--accent)" className="bg-[var(--accent)]/5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-[var(--accent)]">{t('map.currentlyAt')}</span>
                  {(() => {
                    const badge = getTypeBadge(currentRegion.type, t);
                    if (!badge) return null;
                    return (
                      <Badge customColor={badge.config.bgColor} size="sm">
                        {badge.label}
                      </Badge>
                    );
                  })()}
                </div>
                <Tooltip content={currentRegion.name}>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {currentRegion.name}
                  </h4>
                </Tooltip>
                {currentRegion.description && (
                  <Tooltip content={currentRegion.description} multiline>
                    <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                      {currentRegion.description}
                    </p>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* 子地点列表 */}
            {currentRegionChildren.length > 0 && (
              <div className="mt-2 border-t border-[var(--accent)]/20 pt-2">
                <CollapsibleSection
                  title={t('map.childLocations') ?? '子地点'}
                  count={currentRegionChildren.length}
                  expanded={npcPanelExpanded}
                  onToggle={() => setNpcPanelExpanded(!npcPanelExpanded)}
                >
                  <div className="flex flex-col gap-1">
                    {currentRegionChildren.map((child) => {
                      const childNpcs = npcInfoList.filter(npc => npc.locationId === child.id);
                      return (
                        <div
                          key={child.id}
                          className="rounded-md bg-[var(--bg-secondary)] px-2 py-1.5"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-[var(--text-primary)]">
                              {child.name}
                            </span>
                            {child.type && (() => {
                              const childBadge = getTypeBadge(child.type, t);
                              if (!childBadge) return null;
                              return (
                                <Badge customColor={childBadge.config.bgColor} size="sm">
                                  {childBadge.label}
                                </Badge>
                              );
                            })()}
                          </div>
                          {childNpcs.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {childNpcs.map((npc) => (
                                <span
                                  key={npc.id}
                                  className="inline-flex items-center rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]"
                                >
                                  👤 {npc.name || npc.id}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {/* NPC列表 */}
            {npcNamesInCurrentRegion.length > 0 && (
              <div className="mt-2 border-t border-[var(--accent)]/20 pt-2">
                <CollapsibleSection
                  title="NPC"
                  count={npcNamesInCurrentRegion.length}
                  expanded={npcPanelExpanded}
                  onToggle={() => setNpcPanelExpanded(!npcPanelExpanded)}
                >
                  <div className="flex flex-wrap gap-1">
                    {npcNamesInCurrentRegion.map((npcName, idx) => (
                      <span
                        key={`${npcName}-${idx}`}
                        className="inline-flex items-center rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                      >
                        👤 {npcName}
                      </span>
                    ))}
                  </div>
                </CollapsibleSection>
              </div>
            )}
          </Card>
        )}

        {displayMode === 'list' && (
          <>
            <div className="flex flex-col gap-1.5">
              {regionsForSelectedMap
                .filter((loc) => isDiscovered(loc))
                .map((loc) => {
                  const isSelected = selectedId === loc.id;
                  const isCurrent = loc.id === currentRegion?.id;
                  const badge = getTypeBadge(loc.type, t);
                  const neighbors = getConnectionsForRegion(loc.id);
                  const hasConnections = neighbors.length > 0;
                  const subLocCount = locations.filter(
                    (l) => l.parentLocationId === loc.id && l.locationLevel === 3
                  ).length;
                  const subLocNpcs = npcInfoList.filter(npc => npc.locationId === loc.id);

                  return (
                    <Card
                      key={loc.id}
                      variant="default"
                      padding="sm"
                      hoverable
                      onClick={() => setSelectedId(isSelected ? null : loc.id)}
                      className={cn(
                        isCurrent && 'border-[var(--accent)] bg-[var(--accent)]/5'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Tooltip content={loc.name}>
                              <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
                                {loc.name}
                              </h4>
                            </Tooltip>
                            {badge && (
                              <Badge customColor={badge.config.bgColor} size="sm">
                                {badge.label}
                              </Badge>
                            )}
                            {isCurrent && (
                              <Badge variant="info" size="sm">{t('map.currentlyAt')}</Badge>
                            )}
                          </div>
                          {loc.description && (
                            <Tooltip content={loc.description} multiline>
                              <p className="mt-0.5 text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                                {loc.description}
                              </p>
                            </Tooltip>
                          )}
                          <div className="mt-1 flex items-center gap-3">
                            {subLocCount > 0 && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {subLocCount} {t('map.childLocations') ?? '子地点'}
                              </span>
                            )}
                            {subLocNpcs.length > 0 && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {subLocNpcs.length} NPC
                              </span>
                            )}
                            {hasConnections && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {neighbors.length} {t('map.paths')}
                              </span>
                            )}
                            {(() => {
                              const locDisplay = resolveMapLocationDisplay(loc);
                              if (locDisplay.dangerLevel === undefined) return null;
                              const dangerColor = locDisplay.dangerLevel >= 7 ? 'var(--error)' : locDisplay.dangerLevel >= 4 ? 'var(--warning)' : 'var(--success)';
                              return (
                                <span className="text-[10px]" style={{ color: dangerColor }}>
                                  {t('map.danger')} Lv.{locDisplay.dangerLevel}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      {isSelected && hasConnections && (
                        <div className="mt-2.5 border-t border-[var(--border-primary)] pt-2">
                          <span className="text-[10px] font-medium text-[var(--text-muted)]">{t('map.connectedPaths')}</span>
                          <div className="mt-1 flex flex-col gap-1">
                            {neighbors.map((neighbor) => {
                              const connInfo = getConnectionInfo(loc.id, neighbor.id);
                              return (
                                <div key={neighbor.id} className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
                                  <span className="text-[var(--text-muted)]">→</span>
                                  <span>{neighbor.name}</span>
                                  {connInfo?.travelTime != null && (
                                    <span className="text-[var(--text-muted)]">({connInfo.travelTime}h)</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
            </div>

            {regionsForSelectedMap.filter((loc) => !isDiscovered(loc)).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <LockClosedIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <span className="text-xs font-medium text-[var(--text-muted)]">{t('map.undiscovered')}</span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    ({regionsForSelectedMap.filter((loc) => !isDiscovered(loc)).length})
                  </span>
                </div>
                {regionsForSelectedMap.filter((loc) => !isDiscovered(loc)).map((loc) => (
                  <div
                    key={loc.id}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 opacity-40"
                  >
                    <div className="flex items-center gap-2">
                      <LockClosedIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      <span className="text-sm italic text-[var(--text-muted)]">???</span>
                      {loc.type && (() => {
                        const badge = getTypeBadge(loc.type, t);
                        if (!badge) return null;
                        return (
                          <Badge customColor={badge.config.bgColor} size="sm" className="opacity-50">
                            {badge.label}
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <Card variant="default" padding="md" className={cn('flex flex-col gap-3', className)}>
      {/* 世界地图/区域视图切换按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant={viewMode === 'world' ? 'primary' : 'outline'}
            size="sm"
            onClick={handleBackToWorld}
          >
            <GlobeAltIcon className="h-3.5 w-3.5 mr-1" />
            {t('map.worldMap') ?? '世界地图'}
          </Button>
          {currentMap && (
            <Button
              variant={viewMode === 'region' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setViewModeAction('region')}
            >
              <MapIcon className="h-3.5 w-3.5 mr-1" />
              {currentMap.name}
            </Button>
          )}
        </div>
      </div>

      {viewMode === 'world' && renderWorldView()}
      {viewMode === 'region' && renderRegionView()}
    </Card>
  );
});
