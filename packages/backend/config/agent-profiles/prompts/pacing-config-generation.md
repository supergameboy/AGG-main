# 节奏配置生成指令

根据以下模板 AI 约束，生成游戏节奏配置参数。

## 模板 AI 约束
{templateAIConstraints}

## 输出格式
```json
{
  "tensionRange": { "min": number, "max": number },
  "tensionWeights": {
    "combat": number, "threat": number, "resource": number, "info": number, "time": number
  },
  "densityParams": {
    "windowSize": number, "cooldownRounds": number, "rareBudget": number, "rareWindow": number
  },
  "progressParams": { "sigmoidK": number, "sigmoidT0": number },
  "stageThresholds": {
    "exposition": number, "rising": number, "climax": number, "falling": number, "resolution": number
  },
  "pacingInterval": number
}
```

## 生成规则

1. 将 tone=dark 的紧张度范围设为 [50,90]
2. 将 tone=lighthearted 的紧张度范围设为 [10,60]
3. 当 required_elements 含 combat 时提升战斗强度权重
4. 当 content_rating=mature 时提升威胁程度权重
5. 确保权重总和为 1.0
6. 将 pacingInterval 设为 3-7 之间
