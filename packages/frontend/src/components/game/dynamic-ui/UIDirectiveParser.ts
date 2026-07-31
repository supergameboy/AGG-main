import type { UIParsedNode } from '@ai-rpg/shared';

const COMPONENT_OPEN_RE = /^:::([\w-]+)\s*(\{.*\})?\s*$/;
const COMPONENT_CLOSE_RE = /^:::\s*$/;
const MERMAID_OPEN_RE = /^```mermaid\s*$/;
const MERMAID_CLOSE_RE = /^```\s*$/;
const INLINE_COMPONENT_RE = /^:::([\w-]+)\s*(\{.*\})?\s*(.+?):::\s*$/;
const SELF_CLOSING_RE = /^:::([\w-]+)\s*(\{.*\})?\s*:*\s*$/;

const SELF_CLOSING_COMPONENTS = new Set([
  'stat-block',
  'divider',
  'icon',
  'avatar',
  'enemy-card',
  'item-card',
  'quest-item',
  'skill-card',
  'npc-card',
  'progress',
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
      if (last.type === 'text' && last.content) {
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

    appendText(line);
  }

  return roots;
}
