import type { UIParsedNode } from '@ai-rpg/shared';

const COMPONENT_OPEN_RE = /^:::([\w-]+)\s*(\{.*\})?\s*$/;
const COMPONENT_CLOSE_RE = /^:::\s*$/;
const MERMAID_OPEN_RE = /^```mermaid\s*$/;
const MERMAID_CLOSE_RE = /^```\s*$/;
const INLINE_COMPONENT_RE = /^:::([\w-]+)\s*(\{.*\})?\s*(.+?):::\s*$/;
const SELF_CLOSING_RE = /^:::([\w-]+)\s*(\{.*\})?\s*:*\s*$/;

// 真空自闭合组件：语法上从不携带子内容，单行 :::name{...} 即完成
const SELF_CLOSING_COMPONENTS = new Set([
  'stat-block',
  'divider',
  'icon',
  'avatar',
  'progress',
  'switch',
  'select',
]);

// 卡片二义组件：既可单行自闭合（:::npc-card{...}），也可作为容器携带子内容
// （:::npc-card{...}\n描述文本\n:::）。静态集合无法同时覆盖两种用法，
// 需在 open 行做前瞻消歧：下一个非空行为纯文本内容 → 容器；否则 → 自闭合。
const AMBIGUOUS_CARD_COMPONENTS = new Set([
  'character-status',
  'enemy-card',
  'item-card',
  'quest-item',
  'skill-card',
  'npc-card',
]);

/**
 * Parse attribute string like `{key1="val" key2=123 key3={"obj":true} key4=[1,2]}`.
 * Supports:
 * - Quoted strings: key="value"
 * - Unquoted words: key=value
 * - JSON objects: key={"k":"v"}
 * - JSON arrays: key=[1,2,3]
 */
function parseAttrs(attrStr: string | undefined): Record<string, unknown> {
  if (!attrStr) return {};
  const inner = attrStr.slice(1, -1).trim();
  if (!inner) return {};
  const attrs: Record<string, unknown> = {};

  let i = 0;
  while (i < inner.length) {
    // Skip whitespace
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length) break;

    // Read key
    const keyStart = i;
    while (i < inner.length && /[\w-]/.test(inner[i])) i++;
    const key = inner.slice(keyStart, i);
    if (!key) break;

    // Skip whitespace and '='
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length || inner[i] !== '=') break;
    i++; // skip '='
    while (i < inner.length && /\s/.test(inner[i])) i++;

    if (i >= inner.length) break;

    // Read value
    let value: unknown;
    if (inner[i] === '"') {
      // Quoted string value
      i++; // skip opening quote
      const valStart = i;
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === '\\') i++; // skip escaped char
        i++;
      }
      value = inner.slice(valStart, i);
      if (i < inner.length) i++; // skip closing quote
    } else if (inner[i] === '{' || inner[i] === '[') {
      // JSON object or array value
      const opener = inner[i];
      const closer = opener === '{' ? '}' : ']';
      const valStart = i;
      let depth = 0;
      let inString = false;
      let escape = false;
      while (i < inner.length) {
        const ch = inner[i];
        if (escape) {
          escape = false;
        } else if (ch === '\\' && inString) {
          escape = true;
        } else if (ch === '"' && !escape) {
          inString = !inString;
        } else if (!inString) {
          if (ch === opener) depth++;
          else if (ch === closer) {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
        }
        i++;
      }
      const rawValue = inner.slice(valStart, i);
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue;
      }
    } else {
      // Unquoted value (word, number, boolean)
      const valStart = i;
      while (i < inner.length && !/[\s}]/.test(inner[i])) i++;
      const rawValue = inner.slice(valStart, i);
      if (rawValue === 'true') {
        value = true;
      } else if (rawValue === 'false') {
        value = false;
      } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
        value = Number(rawValue);
      } else {
        value = rawValue;
      }
    }

    attrs[key] = value;
  }

  return attrs;
}

/**
 * 从字符串 from 位置（必须是 ::: 起点）尝试解析一个行内组件 `:::name{attrs}content:::`。
 * 成功返回节点与结束位置（::: 之后），失败返回 null。
 */
function tryParseInlineAt(
  s: string,
  from: number
): { node: UIParsedNode; end: number } | null {
  const nameMatch = /^:::([\w-]+)\s*/.exec(s.slice(from));
  if (!nameMatch) return null;
  const componentName = nameMatch[1];
  let pos = from + nameMatch[0].length;

  let attrStr: string | undefined;
  if (s[pos] === '{') {
    // 括号配平扫描（忽略字符串内括号），支持 JSON 对象/数组属性值
    let depth = 0;
    let inStr = false;
    let esc = false;
    let i = pos;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) return null;
    attrStr = s.slice(pos, i);
    pos = i;
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  }

  const endMark = s.indexOf(':::', pos);
  if (endMark === -1 || endMark === pos) return null;
  const inlineContent = s.slice(pos, endMark);

  return {
    node: {
      type: 'component',
      component: componentName,
      attrs: parseAttrs(attrStr),
      children: [{ type: 'text', content: inlineContent.trim(), inline: true }],
      inline: true,
    },
    end: endMark + 3,
  };
}

/**
 * 切分含行内组件的文本行（如 "这把剑附有 :::tooltip{...}火焰附魔::: 效果。"）。
 * 返回 null 表示行内无合法行内组件（按普通文本处理）。
 * 产出的文本/组件节点均标记 inline: true，供渲染层合并为同一段落流式渲染。
 */
function splitInlineSegments(line: string): UIParsedNode[] | null {
  const segments: UIParsedNode[] = [];
  let cursor = 0;
  let found = false;

  while (cursor < line.length) {
    const start = line.indexOf(':::', cursor);
    if (start === -1) break;
    const parsed = tryParseInlineAt(line, start);
    if (!parsed) {
      // 非合法行内组件，跳过该 ::: 继续向后查找
      cursor = start + 3;
      continue;
    }
    if (start > cursor) {
      const textBefore = line.slice(cursor, start);
      if (textBefore) {
        segments.push({ type: 'text', content: textBefore, inline: true });
      }
    }
    segments.push(parsed.node);
    found = true;
    cursor = parsed.end;
  }

  if (!found) return null;

  const tail = line.slice(cursor);
  if (tail) {
    segments.push({ type: 'text', content: tail, inline: true });
  }
  return segments;
}

/**
 * 卡片二义前瞻消歧：判断 openIndex 处的卡片组件是否作为容器使用。
 * 规则：下一个非空行为纯文本内容（非 ::: 组件语法、非 ::: 结束标记）→ 容器；
 * 否则（紧跟组件/结束标记/EOF）→ 自闭合。
 */
function isAmbiguousCardContainer(lines: string[], openIndex: number): boolean {
  for (let j = openIndex + 1; j < lines.length; j++) {
    const next = lines[j].trim();
    if (!next) continue;
    if (next.startsWith(':::')) return false;
    if (MERMAID_OPEN_RE.test(next)) return false;
    return true;
  }
  return false;
}

export function parseUIDirective(markdown: string): UIParsedNode[] {
  const lines = markdown.split('\n');
  const roots: UIParsedNode[] = [];
  const stack: { node: UIParsedNode; indent: number }[] = [];
  let inMermaid = false;
  let mermaidContent = '';
  let mermaidParent: UIParsedNode | null = null;

  function currentParent(): UIParsedNode | null {
    return stack.length > 0 ? stack[stack.length - 1].node : null;
  }

  function pushNode(node: UIParsedNode): void {
    const parent = currentParent();
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function appendText(text: string): void {
    if (!text) return;
    const parent = currentParent();
    if (parent && parent.children && parent.children.length > 0) {
      const last = parent.children[parent.children.length - 1];
      if (last.type === 'text' && last.content && !last.inline) {
        last.content += '\n' + text;
        return;
      }
    }
    pushNode({ type: 'text', content: text });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inMermaid) {
      if (MERMAID_CLOSE_RE.test(line)) {
        inMermaid = false;
        const mermaidNode: UIParsedNode = {
          type: 'mermaid',
          content: mermaidContent.trim(),
        };
        if (mermaidParent && mermaidParent.children) {
          mermaidParent.children.push(mermaidNode);
        } else {
          roots.push(mermaidNode);
        }
        mermaidContent = '';
        mermaidParent = null;
      } else {
        mermaidContent += line + '\n';
      }
      continue;
    }

    const selfClosingMatch = SELF_CLOSING_RE.exec(line);
    if (selfClosingMatch) {
      const componentName = selfClosingMatch[1];
      const attrStr = selfClosingMatch[2];
      if (SELF_CLOSING_COMPONENTS.has(componentName)) {
        pushNode({
          type: 'component',
          component: componentName,
          attrs: parseAttrs(attrStr),
        });
        continue;
      }
    }

    const inlineMatch = INLINE_COMPONENT_RE.exec(line);
    if (inlineMatch) {
      const componentName = inlineMatch[1];
      const attrStr = inlineMatch[2];
      const inlineContent = inlineMatch[3];
      pushNode({
        type: 'component',
        component: componentName,
        attrs: parseAttrs(attrStr),
        children: inlineContent
          ? [{ type: 'text', content: inlineContent.trim() }]
          : undefined,
      });
      continue;
    }

    const openMatch = COMPONENT_OPEN_RE.exec(line);
    if (openMatch) {
      const componentName = openMatch[1];
      const attrStr = openMatch[2];

      // 卡片二义前瞻消歧：单行自闭合用法直接产出叶子节点，不压栈
      if (
        AMBIGUOUS_CARD_COMPONENTS.has(componentName) &&
        !isAmbiguousCardContainer(lines, i)
      ) {
        pushNode({
          type: 'component',
          component: componentName,
          attrs: parseAttrs(attrStr),
        });
        continue;
      }

      const node: UIParsedNode = {
        type: 'component',
        component: componentName,
        attrs: parseAttrs(attrStr),
        children: [],
      };
      pushNode(node);
      stack.push({ node, indent: 0 });

      if (
        componentName === 'minimap' ||
        componentName === 'skill-tree'
      ) {
        for (let j = i + 1; j < lines.length; j++) {
          if (MERMAID_OPEN_RE.test(lines[j])) {
            inMermaid = true;
            mermaidParent = node;
            // 跳过 ```mermaid 围栏行本身，防止其被累积进 mermaidContent
            // （否则 parseMermaidToFlowData 的 firstLine 校验必然失败）
            i = j;
            break;
          }
          if (COMPONENT_CLOSE_RE.test(lines[j])) {
            break;
          }
        }
      }
      continue;
    }

    if (COMPONENT_CLOSE_RE.test(line)) {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    if (MERMAID_OPEN_RE.test(line)) {
      inMermaid = true;
      mermaidParent = currentParent();
      mermaidContent = '';
      continue;
    }

    // 行内组件切分：一行文本中嵌套 :::name{...}...::: 时拆分为 文本+组件+文本 行内段
    if (line.includes(':::')) {
      const segments = splitInlineSegments(line);
      if (segments) {
        for (const seg of segments) pushNode(seg);
        continue;
      }
    }

    appendText(line);
  }

  return roots;
}
