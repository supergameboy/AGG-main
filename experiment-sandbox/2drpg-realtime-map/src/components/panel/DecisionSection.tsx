/**
 * 决策分叉口（核心分区）：设计文档全部关键决策点的 A/B 即时对比
 * 每项决策标注设计文档出处，切换后地图立即体现视觉/交互差异。
 */

import React from 'react';
import { useConfigStore } from '@/stores/configStore';
import { Segmented, Hint } from './controls';

export const DecisionSection: React.FC = () => {
  const decisions = useConfigStore((s) => s.decisions);
  const setDecisions = useConfigStore((s) => s.setDecisions);

  return (
    <div className="space-y-3">
      <Segmented
        label="渲染器类型（DOM MVP ↔ Canvas 等距）"
        docRef="附录D §四 分阶段路径"
        value={decisions.rendererType}
        onChange={(v) => setDecisions({ rendererType: v as 'css_grid' | 'canvas_2d' })}
        options={[
          { value: 'css_grid', label: 'CSS Grid (Phase 1)', hint: 'DOM div + mvpColor/emoji，俯视 MVP，验证业务逻辑' },
          { value: 'canvas_2d', label: 'Canvas 2D (Phase 2)', hint: '等距真渲染，暗黑类 2.5D 基线' },
          { value: 'pixi_v8', label: 'PixiJS (stub)', hint: '主项目 Phase 3 消除 stub，沙箱不实装', disabled: true },
          { value: 'three_js', label: 'Three.js (stub)', hint: '主项目 Phase 4 可选，沙箱不实装', disabled: true },
        ]}
      />

      {decisions.rendererType === 'canvas_2d' && (
        <Segmented
          label="渲染风格（游戏模式 → 风格映射）"
          docRef="附录D §5.2"
          value={decisions.renderStyle}
          onChange={(v) => setDecisions({ renderStyle: v as typeof decisions.renderStyle })}
          options={[
            { value: 'top_down', label: '俯视 top_down', hint: '宝可梦风俯视，无等距变换' },
            { value: 'isometric', label: '等距 isometric', hint: '菱形投影 + 画家算法深度排序' },
            { value: 'isometric_25d', label: '2.5D 暗黑', hint: '等距 + 光照/火把/暗角，暗黑类混合渲染' },
          ]}
        />
      )}

      <Segmented
        label="LLM 边界处理策略"
        docRef="模块2 §3.4"
        value={decisions.boundaryStrategy}
        onChange={(v) => setDecisions({ boundaryStrategy: v as typeof decisions.boundaryStrategy })}
        options={[
          { value: 'hard_boundary', label: '策略A 硬边界', hint: '不感知邻居，token 省、并发高，靠渲染层美化兜底' },
          { value: 'context_aware', label: '策略B 带上下文', hint: '读取已 ready 邻居边界，风格协调 + 道路对齐' },
        ]}
      />

      {decisions.rendererType === 'canvas_2d' && (
        <Segmented
          label="渲染层边界美化（接管模块2 过渡地形）"
          docRef="模块5 §2.1.5"
          value={decisions.boundarySmoothing}
          onChange={(v) => setDecisions({ boundarySmoothing: v as typeof decisions.boundarySmoothing })}
          options={[
            { value: 'none', label: '无（硬接缝）', hint: 'MVP 接受硬接缝，便于观察策略A 数据层差异' },
            { value: 'alpha_blend', label: '边缘 alpha 混合', hint: 'Canvas 2D 标准美化' },
            { value: 'shader_mix', label: '强混合(模拟)', hint: '更宽渐变带，模拟 PixiJS shader_mix 观感' },
          ]}
        />
      )}

      <Segmented
        label="建筑内部方案（进建筑体验分叉）"
        docRef="模块6 §2.2 对比测试"
        value={decisions.interiorScheme}
        onChange={(v) => setDecisions({ interiorScheme: v as 'A' | 'B' })}
        options={[
          { value: 'A', label: '方案A 独立地图', hint: '塞尔达式：切图有加载（~180ms），坐标系独立' },
          { value: 'B', label: '方案B Z 层切层', hint: '星露谷式：同图分层秒切（<50ms），塔楼可爬楼梯' },
        ]}
      />

      <Segmented
        label="区块大小（生成质量/流式粒度权衡）"
        docRef="附录E §三 推荐 64"
        value={String(decisions.chunkSize)}
        onChange={(v) => setDecisions({ chunkSize: Number(v) as typeof decisions.chunkSize })}
        options={[
          { value: '32', label: '32×32', hint: '粒度细、token 省，但区块管理开销大' },
          { value: '64', label: '64×64 (推荐)', hint: 'LLMGG 论文验证 100% 正确率的尺寸' },
          { value: '96', label: '96×96', hint: '生成时间 +60%，流式加载粒度变粗（附录E 不推荐）' },
        ]}
      />

      <Segmented
        label="生成器路由（速度 ↔ 丰富度）"
        docRef="模块2 §3.3.5 GeneratorRouter"
        value={decisions.generatorKind}
        onChange={(v) => setDecisions({ generatorKind: v as typeof decisions.generatorKind })}
        options={[
          { value: 'procedural', label: '程序化', hint: '<50ms 即时，Perlin 噪声，LLM 失败兜底' },
          { value: 'mock_llm', label: 'Mock LLM', hint: '模拟延迟 + 河流/道路/村庄丰富地形，不耗额度' },
          { value: 'auto', label: 'auto 路由', hint: 'city/dungeon→LLM，wilderness→程序化' },
        ]}
      />

      <Segmented
        label="LLM 输出格式（token 成本对比见生成日志）"
        docRef="模块2 §3.2"
        value={decisions.outputFormat}
        onChange={(v) => setDecisions({ outputFormat: v as 'atl' | 'json' })}
        options={[
          { value: 'atl', label: 'ATL 字符图', hint: '节省约 60% token（LLMGG P7 策略）' },
          { value: 'json', label: 'JSON 结构化', hint: 'LLM 最熟悉、出错率低，token +60%' },
        ]}
      />

      <Segmented
        label="地图规模（性能测试规模矩阵）"
        docRef="模块7 §2.5.1"
        value={decisions.mapScale}
        onChange={(v) => setDecisions({ mapScale: v as typeof decisions.mapScale })}
        options={[
          { value: 'small', label: '小 ~100×100', hint: '2×2 区块（64 区块尺寸时）' },
          { value: 'medium', label: '中 ~500×500', hint: '8×8 区块' },
          { value: 'large', label: '大 ~1000×1000', hint: '16×16 区块，压力测试' },
        ]}
      />

      <Segmented
        label="LLM 模式（沙箱固定 mock）"
        docRef="模块7 §2.4"
        value="mock"
        onChange={() => {}}
        options={[
          { value: 'mock', label: 'mock（永久保留）', hint: '不消耗额度，仅测前端渲染链路' },
          { value: 'real', label: 'real（主项目）', hint: '真实 LLM 调度，主项目落地时启用', disabled: true },
        ]}
      />

      <Hint>
        决策快照（DecisionSnapshot）将嵌入性能报告。区块大小 / 地图规模切换会重建世界；其余决策即时生效 ——
        例如切「策略A 硬边界 + 美化=无」可直观看到区块接缝，再切「策略B + alpha_blend」对比。
      </Hint>
    </div>
  );
};
