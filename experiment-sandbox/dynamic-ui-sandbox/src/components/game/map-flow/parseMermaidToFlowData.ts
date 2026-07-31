export type MermaidDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';

/** mermaid style/classDef 声明解析出的节点样式（camelCase 化） */
export interface MermaidNodeStyle {
  fill?: string;
  color?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeDasharray?: string;
}

export interface ParsedFlowNode {
  id: string;
  label: string;
  class?: string;
  /** 合并 classDef 与 style 行后的最终样式；style 行覆盖 classDef 同名属性 */
  style?: MermaidNodeStyle;
}

export interface ParsedFlowEdge {
  from: string;
  to: string;
  label?: string;
  /** --> / ==> / -.-> 为有向；--- 为无向 */
  directed: boolean;
}

const NODE_WITH_BRACKET_RE = /^(\w+)\["([^"]+)"\](:::(\w+))?/;
const NODE_WITH_SQUARE_RE = /^(\w+)\[([^\]]+)\](:::(\w+))?/;
const NODE_WITH_CURLY_RE = /^(\w+)\{([^}]+)\}(:::(\w+))?/;
const NODE_WITH_CIRCLE_RE = /^(\w+)\(\(([^)]+)\)\)(:::(\w+))?/;
const NODE_WITH_ASYMMETRIC_RE = /^(\w+)\>([^\]]+)\](:::(\w+))?/;
const NODE_BARE_RE = /^(\w+)$/;

const EDGE_PATTERNS: Array<{
  re: RegExp;
  directed: boolean;
}> = [
  { re: /^(.+?)\s*==>\s*(.+)$/, directed: true },
  { re: /^(.+?)\s*-\.->\s*(.+)$/, directed: true },
  { re: /^(.+?)\s*-->\s*(.+)$/, directed: true },
  { re: /^(.+?)\s*---\s*(.+)$/, directed: false },
];

const EDGE_LABEL_PIPE_RE = /\|([^|]+)\|/;
const EDGE_LABEL_DASH_RE = /^--([^>].*?)-->/;

const DIRECTION_RE = /^(?:graph|flowchart)\s+(TB|TD|BT|LR|RL)/i;
const CLASS_DEF_RE = /^classDef\s+(\w+)\s+(.+)$/i;
const CLASS_ASSIGN_RE = /^class\s+([\w\s,]+?)\s+(\w+)$/i;
const STYLE_LINE_RE = /^style\s+(\w+)\s+(.+)$/i;

function extractNodeDef(token: string): { id: string; label: string; class?: string } | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  let m = trimmed.match(NODE_WITH_CIRCLE_RE);
  if (m) return { id: m[1], label: m[2], class: m[4] };

  m = trimmed.match(NODE_WITH_BRACKET_RE);
  if (m) return { id: m[1], label: m[2], class: m[4] };

  m = trimmed.match(NODE_WITH_CURLY_RE);
  if (m) return { id: m[1], label: m[2], class: m[4] };

  m = trimmed.match(NODE_WITH_ASYMMETRIC_RE);
  if (m) return { id: m[1], label: m[2], class: m[4] };

  m = trimmed.match(NODE_WITH_SQUARE_RE);
  if (m) return { id: m[1], label: m[2], class: m[4] };

  m = trimmed.match(NODE_BARE_RE);
  if (m) return { id: m[1], label: m[1] };

  return null;
}

function stripClassSuffix(token: string): string {
  return token.replace(/:::\w+$/, '').trim();
}

/** 解析 `fill:#xxx,color:#fff,stroke-width:3px` 声明串；仅保留白名单属性 */
function parseStyleDeclarations(raw: string): MermaidNodeStyle {
  const style: MermaidNodeStyle = {};
  for (const pair of raw.split(',')) {
    const sep = pair.indexOf(':');
    if (sep === -1) continue;
    const key = pair.slice(0, sep).trim();
    const value = pair.slice(sep + 1).trim();
    if (!value) continue;
    switch (key) {
      case 'fill': style.fill = value; break;
      case 'color': style.color = value; break;
      case 'stroke': style.stroke = value; break;
      case 'stroke-width': style.strokeWidth = value; break;
      case 'stroke-dasharray': style.strokeDasharray = value; break;
    }
  }
  return style;
}

function parseEdgeLine(line: string): {
  from: string;
  to: string;
  label?: string;
  directed: boolean;
  fromNode: { id: string; label: string; class?: string } | null;
  toNode: { id: string; label: string; class?: string } | null;
} | null {
  let edgeLabel: string | undefined;

  const dashLabelMatch = line.match(EDGE_LABEL_DASH_RE);
  if (dashLabelMatch) {
    edgeLabel = dashLabelMatch[1].trim();
    line = line.replace(dashLabelMatch[0], '-->');
  }

  for (const { re, directed } of EDGE_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;

    let leftPart = m[1].trim();
    let rightPart = m[2].trim();

    if (!edgeLabel) {
      const pipeMatch = leftPart.match(EDGE_LABEL_PIPE_RE);
      if (pipeMatch) {
        edgeLabel = pipeMatch[1].trim();
        leftPart = leftPart.replace(EDGE_LABEL_PIPE_RE, '').trim();
      } else {
        const rightPipeMatch = rightPart.match(EDGE_LABEL_PIPE_RE);
        if (rightPipeMatch) {
          edgeLabel = rightPipeMatch[1].trim();
          rightPart = rightPart.replace(EDGE_LABEL_PIPE_RE, '').trim();
        }
      }
    }

    const fromNode = extractNodeDef(leftPart);
    const toNode = extractNodeDef(rightPart);

    const fromId = fromNode?.id ?? stripClassSuffix(leftPart);
    const toId = toNode?.id ?? stripClassSuffix(rightPart);

    return {
      from: fromId,
      to: toId,
      label: edgeLabel,
      directed,
      fromNode,
      toNode,
    };
  }

  return null;
}

export function parseMermaidToFlowData(mermaidCode: string): {
  nodes: ParsedFlowNode[];
  edges: ParsedFlowEdge[];
  direction: MermaidDirection;
} {
  const empty: { nodes: ParsedFlowNode[]; edges: ParsedFlowEdge[]; direction: MermaidDirection } = {
    nodes: [],
    edges: [],
    direction: 'TD',
  };
  try {
    const nodeMap = new Map<string, ParsedFlowNode>();
    const edges: ParsedFlowEdge[] = [];
    const classDefMap = new Map<string, MermaidNodeStyle>();
    const classAssignMap = new Map<string, string>();
    const styleLineMap = new Map<string, MermaidNodeStyle>();

    const lines = mermaidCode.split('\n').map((l) => l.trim()).filter(Boolean);

    if (lines.length === 0) return empty;

    const dirMatch = lines[0].match(DIRECTION_RE);
    if (!dirMatch) return empty;
    const direction = dirMatch[1].toUpperCase() as MermaidDirection;

    const addNode = (node: { id: string; label: string; class?: string } | null) => {
      if (!node || nodeMap.has(node.id)) return;
      nodeMap.set(node.id, { id: node.id, label: node.label, class: node.class });
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      const classDefMatch = line.match(CLASS_DEF_RE);
      if (classDefMatch) {
        classDefMap.set(classDefMatch[1], parseStyleDeclarations(classDefMatch[2]));
        continue;
      }

      const classAssignMatch = line.match(CLASS_ASSIGN_RE);
      if (classAssignMatch) {
        const ids = classAssignMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
        for (const id of ids) classAssignMap.set(id, classAssignMatch[2]);
        continue;
      }

      const styleMatch = line.match(STYLE_LINE_RE);
      if (styleMatch) {
        styleLineMap.set(styleMatch[1], parseStyleDeclarations(styleMatch[2]));
        continue;
      }

      if (/^click\s/i.test(line)) continue;
      if (/^subgraph\s/i.test(line)) continue;
      if (/^end$/i.test(line)) continue;
      if (/^:::/.test(line)) continue;

      const edgeResult = parseEdgeLine(line);
      if (edgeResult) {
        addNode(edgeResult.fromNode);
        addNode(edgeResult.toNode);

        if (!nodeMap.has(edgeResult.from)) {
          nodeMap.set(edgeResult.from, { id: edgeResult.from, label: edgeResult.from });
        }
        if (!nodeMap.has(edgeResult.to)) {
          nodeMap.set(edgeResult.to, { id: edgeResult.to, label: edgeResult.to });
        }

        edges.push({
          from: edgeResult.from,
          to: edgeResult.to,
          label: edgeResult.label,
          directed: edgeResult.directed,
        });
        continue;
      }

      addNode(extractNodeDef(line));
    }

    // 样式合并：行内 :::class 后缀优先于 class 指派行；style 行覆盖 classDef 同名属性
    const nodes: ParsedFlowNode[] = [];
    for (const node of nodeMap.values()) {
      const cls = node.class ?? classAssignMap.get(node.id);
      const merged: MermaidNodeStyle = {
        ...(cls ? classDefMap.get(cls) : undefined),
        ...styleLineMap.get(node.id),
      };
      nodes.push({
        ...node,
        class: cls,
        style: Object.keys(merged).length > 0 ? merged : undefined,
      });
    }

    return { nodes, edges, direction };
  } catch {
    return empty;
  }
}
