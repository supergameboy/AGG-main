import { describe, it, expect } from 'vitest';
import { FrontmatterError, parseFrontmatter } from '../frontmatter-parser.js';

describe('parseFrontmatter', () => {
  describe('基础解析', () => {
    it('parses standard frontmatter with body', () => {
      const doc = parseFrontmatter('---\nname: test\n---\n# Title\nbody text');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({ name: 'test' });
      expect(doc.body).toBe('# Title\nbody text');
      expect(doc.rawFrontmatter).toBe('name: test');
    });

    it('empty frontmatter yields empty attributes', () => {
      const doc = parseFrontmatter('---\n---\nbody');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({});
      expect(doc.body).toBe('body');
    });

    it('document with only frontmatter yields empty body', () => {
      const doc = parseFrontmatter('---\nname: test\n---\n');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.body).toBe('');
    });

    it('document without frontmatter returns hasFrontmatter=false and full body', () => {
      const doc = parseFrontmatter('Just some text\nmore text');
      expect(doc.hasFrontmatter).toBe(false);
      expect(doc.attributes).toEqual({});
      expect(doc.body).toBe('Just some text\nmore text');
      expect(doc.rawFrontmatter).toBe('');
    });
  });

  describe('分隔符边界', () => {
    it('handles CRLF line endings', () => {
      const doc = parseFrontmatter('---\r\nname: test\r\n---\r\nbody');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({ name: 'test' });
      expect(doc.body).toBe('body');
    });

    it('handles CR line endings', () => {
      const doc = parseFrontmatter('---\rname: test\r---\rbody');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({ name: 'test' });
      expect(doc.body).toBe('body');
    });

    it('strips BOM prefix', () => {
      const doc = parseFrontmatter('﻿---\nname: test\n---\nbody');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({ name: 'test' });
    });

    it('handles closing --- directly followed by EOF', () => {
      const doc = parseFrontmatter('---\nname: test\n---');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({ name: 'test' });
      expect(doc.body).toBe('');
    });

    it('only the first \\n--- ends the frontmatter; later --- lines stay in body', () => {
      const doc = parseFrontmatter('---\nname: test\n---\nbody line 1\n---\nbody line 2');
      expect(doc.hasFrontmatter).toBe(true);
      expect(doc.attributes).toEqual({ name: 'test' });
      expect(doc.body).toBe('body line 1\n---\nbody line 2');
    });

    it('indented --- inside block scalar does not end frontmatter', () => {
      const doc = parseFrontmatter('---\ndescription: |\n  line1\n  ---\n  line2\nname: test\n---\nbody');
      expect(doc.attributes.description).toContain('line1');
      expect(doc.attributes.name).toBe('test');
    });

    it('--- start without closing --- is treated as missing frontmatter', () => {
      const doc = parseFrontmatter('---\nname: test\nno closing');
      expect(doc.hasFrontmatter).toBe(false);
      expect(doc.body).toContain('no closing');
    });
  });

  describe('requireFrontmatter', () => {
    it('throws MISSING_FRONTMATTER when required and absent', () => {
      try {
        parseFrontmatter('no frontmatter', { requireFrontmatter: true, filePath: 'f.md' });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(FrontmatterError);
        const e = error as FrontmatterError;
        expect(e.code).toBe('MISSING_FRONTMATTER');
        expect(e.filePath).toBe('f.md');
      }
    });

    it('returns document when required and present', () => {
      const doc = parseFrontmatter('---\nname: x\n---\nbody', { requireFrontmatter: true });
      expect(doc.hasFrontmatter).toBe(true);
    });
  });

  describe('YAML 类型', () => {
    it('parses string/number/boolean/null scalars', () => {
      const doc = parseFrontmatter('---\ns: hello\nn: 42\nb: true\nz: null\n---\nbody');
      expect(doc.attributes).toEqual({ s: 'hello', n: 42, b: true, z: null });
    });

    it('parses flow array [a, b]', () => {
      const doc = parseFrontmatter('---\nlist: [a, b, c]\n---\nbody');
      expect(doc.attributes.list).toEqual(['a', 'b', 'c']);
    });

    it('parses flow array with quoted elements containing commas', () => {
      const doc = parseFrontmatter('---\nlist: ["a,b", "c"]\n---\nbody');
      expect(doc.attributes.list).toEqual(['a,b', 'c']);
    });

    it('parses block list - item', () => {
      const doc = parseFrontmatter('---\nwhenToUse:\n  - first hint\n  - second hint\n---\nbody');
      expect(doc.attributes.whenToUse).toEqual(['first hint', 'second hint']);
    });

    it('parses nested map (paramTypes case)', () => {
      const doc = parseFrontmatter(
        '---\nparamTypes:\n  locations: array (required) - 地点列表\n  count: number\n---\nbody',
      );
      expect(doc.attributes.paramTypes).toEqual({
        locations: 'array (required) - 地点列表',
        count: 'number',
      });
      expect(doc.attributes.locations).toBeUndefined();
    });

    it('parses | block scalar preserving newlines', () => {
      const doc = parseFrontmatter('---\ncriteria: |\n  line one\n  line two\n---\nbody');
      expect(doc.attributes.criteria).toBe('line one\nline two\n');
    });

    it('parses > folded scalar collapsing newlines', () => {
      const doc = parseFrontmatter('---\ncriteria: >\n  line one\n  line two\n---\nbody');
      expect(doc.attributes.criteria).toBe('line one line two\n');
    });

    it('strips quotes from quoted strings', () => {
      const doc = parseFrontmatter('---\na: "quoted"\nb: \'single\'\n---\nbody');
      expect(doc.attributes).toEqual({ a: 'quoted', b: 'single' });
    });

    it('JSON_SCHEMA does not coerce yes/no/on/off to boolean', () => {
      const doc = parseFrontmatter('---\nv1: yes\nv2: off\n---\nbody');
      expect(doc.attributes).toEqual({ v1: 'yes', v2: 'off' });
    });
  });

  describe('错误路径', () => {
    it('throws YAML_SYNTAX_ERROR with line/column/filePath on invalid YAML', () => {
      try {
        parseFrontmatter('---\nkey: value: nested\n---\nbody', { filePath: 'bad.md' });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(FrontmatterError);
        const e = error as FrontmatterError;
        expect(e.code).toBe('YAML_SYNTAX_ERROR');
        expect(e.filePath).toBe('bad.md');
        expect(e.line).toBeTypeOf('number');
        expect(e.column).toBeTypeOf('number');
      }
    });

    it('throws NON_OBJECT_FRONTMATTER when frontmatter is a plain string', () => {
      try {
        parseFrontmatter('---\njust a string\n---\nbody');
        expect.unreachable();
      } catch (error) {
        expect((error as FrontmatterError).code).toBe('NON_OBJECT_FRONTMATTER');
      }
    });

    it('throws NON_OBJECT_FRONTMATTER when frontmatter is an array', () => {
      try {
        parseFrontmatter('---\n- one\n- two\n---\nbody');
        expect.unreachable();
      } catch (error) {
        expect((error as FrontmatterError).code).toBe('NON_OBJECT_FRONTMATTER');
      }
    });

    it('throws YAML_SYNTAX_ERROR on duplicate keys', () => {
      try {
        parseFrontmatter('---\nname: first\nname: second\n---\nbody');
        expect.unreachable();
      } catch (error) {
        expect((error as FrontmatterError).code).toBe('YAML_SYNTAX_ERROR');
      }
    });

    it('inline colon in unquoted value throws YAML_SYNTAX_ERROR', () => {
      try {
        parseFrontmatter('---\ndescription: 创建地点(3层结构: 世界/区域/地点)\n---\nbody');
        expect.unreachable();
      } catch (error) {
        expect((error as FrontmatterError).code).toBe('YAML_SYNTAX_ERROR');
      }
    });
  });
});
