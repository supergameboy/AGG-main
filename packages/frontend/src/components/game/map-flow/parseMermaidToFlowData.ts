export interface ParsedFlowNode {
  id: string;
  label: string;
  class?: string;
}

export interface ParsedFlowEdge {
  from: string;
  to: string;
  label?: string;
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

function parseEdgeLine(line: string): {
  from: string;
  to: string;
  label?: string;
  fromNode: { id: string; label: string; class?: string } | null;
  toNode: { id: string; label: string; class?: string } | null;
} | null {
  let edgeLabel: string | undefined;

  const dashLabelMatch = line.match(EDGE_LABEL_DASH_RE);
  if (dashLabelMatch) {
    edgeLabel = dashLabelMatch[1].trim();
    line = line.replace(dashLabelMatch[0], '-->');
  }

  for (const { re } of EDGE_PATTERNS) {
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
      fromNode,
      toNode,
    };
  }

  return null;
}

export function parseMermaidToFlowData(mermaidCode: string): {
  nodes: ParsedFlowNode[];
  edges: ParsedFlowEdge[];
} {
  try {
    const nodes: ParsedFlowNode[] = [];
    const edges: ParsedFlowEdge[] = [];
    const seenNodeIds = new Set<string>();

    const lines = mermaidCode.split('\n').map((l) => l.trim()).filter(Boolean);

    if (lines.length === 0) return { nodes, edges };

    const firstLine = lines[0];
    const directionRe = /^(?:graph|flowchart)\s+(TB|TD|BT|LR|RL)/i;
    if (!directionRe.test(firstLine)) {
      return { nodes, edges };
    }

    const addNode = (node: { id: string; label: string; class?: string } | null) => {
      if (!node) return;
      if (seenNodeIds.has(node.id)) return;
      seenNodeIds.add(node.id);
      nodes.push({ id: node.id, label: node.label, class: node.class });
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (/^classDef\s/i.test(line)) continue;
      if (/^class\s/i.test(line)) continue;
      if (/^style\s/i.test(line)) continue;
      if (/^click\s/i.test(line)) continue;
      if (/^subgraph\s/i.test(line)) continue;
      if (/^end$/i.test(line)) continue;
      if (/^:::/i.test(line)) continue;

      const edgeResult = parseEdgeLine(line);
      if (edgeResult) {
        addNode(edgeResult.fromNode);
        addNode(edgeResult.toNode);

        if (!seenNodeIds.has(edgeResult.from)) {
          seenNodeIds.add(edgeResult.from);
          nodes.push({ id: edgeResult.from, label: edgeResult.from });
        }
        if (!seenNodeIds.has(edgeResult.to)) {
          seenNodeIds.add(edgeResult.to);
          nodes.push({ id: edgeResult.to, label: edgeResult.to });
        }

        edges.push({
          from: edgeResult.from,
          to: edgeResult.to,
          label: edgeResult.label,
        });
        continue;
      }

      const nodeDef = extractNodeDef(line);
      if (nodeDef) {
        addNode(nodeDef);
      }
    }

    return { nodes, edges };
  } catch {
    return { nodes: [], edges: [] };
  }
}
