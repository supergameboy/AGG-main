# 节奏修正指令

根据以下数据，对确定性节奏计算结果进行修正。

## 当前数据
- 确定性紧张度: {deterministicTension}
- 5维因子: {factors}
- 当前阶段: {currentStage}
- 确定性密度指导: {deterministicDensityGuidance}
- 确定性推进指导: {deterministicSpeedGuidance}
- 当前事件密度: {currentDensity}
- 推进偏离度: {speedDeviation}
- 最近历史: {recentHistory}
- 叙事上下文: {narrativeContext}

## 修正规则
1. 将紧张度修正值限制在确定性值 ±20 以内
2. 将修正后紧张度限制在 [0, 100] 范围内
3. 根据叙事上下文调整：刚经历高潮则回落、铺垫阶段则压低
4. 确定性计算已合理时维持不变
5. 密度指导仅允许在确定性结果的相邻档位间调整（maintain↔increase 或 maintain↔decrease）
6. 推进指导仅允许在确定性结果的相邻档位间调整（maintain↔accelerate 或 maintain↔decelerate）

## 输出格式
```json
{
  "adjustedTension": number,
  "reason": string,
  "stageOverride": "exposition" | "rising" | "climax" | "falling" | "resolution" | null,
  "adjustedDensityGuidance": "increase" | "decrease" | "maintain",
  "adjustedSpeedGuidance": "accelerate" | "decelerate" | "maintain"
}
```
