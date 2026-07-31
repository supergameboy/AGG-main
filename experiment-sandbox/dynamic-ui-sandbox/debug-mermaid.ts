import { parseMermaidToFlowData } from './src/components/game/map-flow/parseMermaidToFlowData';

const mapCode = `graph LR
    A[🏠 村庄] -->|南行| B[🌲 森林入口]
    B -->|深入| C[🏚️ 废弃小屋]
    B -->|东行| D[💧 精灵泉]
    C -->|北行| E[⚔️ 哥布林营地]
    D -->|秘径| F[🏛️ 古代遗迹]

    style A fill:#4CAF50,color:#fff
    style C fill:#FF9800,color:#fff
    style E fill:#f44336,color:#fff
    style F fill:#9C27B0,color:#fff

    classDef current fill:#2196F3,color:#fff,stroke:#1565C0,stroke-width:3px
    class B current`;

const treeCode = `graph TD
    A[⚔️ 基础攻击] --> B[🔥 猛击]
    A --> C[🛡️ 格挡]
    B --> D[💥 旋风斩]
    B --> E[🎯 精准打击]
    C --> F[🔰 铁壁]

    style A fill:#4CAF50,color:#fff
    style D fill:#f44336,color:#fff
    classDef locked fill:#9E9E9E,color:#fff,stroke-dasharray: 5 5
    class E,F locked`;

console.log('=== MAP ===');
console.log(JSON.stringify(parseMermaidToFlowData(mapCode), null, 2));
console.log('=== TREE ===');
console.log(JSON.stringify(parseMermaidToFlowData(treeCode), null, 2));
