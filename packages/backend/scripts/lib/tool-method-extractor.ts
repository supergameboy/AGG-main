/**
 * ToolMethodExtractor — TypeScript Compiler API 静态提取 registerMethod 结构（M7 模块，决策 3）。
 *
 * 从 BaseTool 子类源码提取 ToolDocModel：
 * - toolType 取自 constructor 内 super() 第一个字符串字面量参数（禁止按文件名推导，
 *   CombatServiceTool → 'challenge_service' 为实证案例）
 * - registerMethod({...}) 静态对象字面量逐属性提取 name/description/summary/isWrite/parameters/returns
 * - parameters 递归提取 items/properties 嵌套（ParamDoc 树）
 * - 非静态字段（变量引用/函数调用/带插值模板字符串）记入 dynamicWarnings，该字段不生成
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface ParamDoc {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  /** properties 嵌套子参数 */
  readonly children?: readonly ParamDoc[];
  /** items 嵌套元素类型（name 无意义，固定为空字符串） */
  readonly item?: ParamDoc;
}

export interface MethodDoc {
  readonly name: string;
  /** 动态不可提取时为 undefined（合并时保留现有文档值，见 dynamicWarnings） */
  readonly description?: string;
  readonly summary?: string;
  readonly isWrite: boolean;
  readonly parameters: readonly ParamDoc[];
  /** parameters 非静态对象字面量降级为 [] 时置 true（合并时保留现有文档 paramTypes，§9.5） */
  readonly parametersDynamic?: boolean;
  /** 从 returns.properties.data.description 提取的 `(TypeName)` 括号类型名；无则不编造 */
  readonly returnTypeName?: string;
  readonly returnsDescription?: string;
}

export interface ToolDocModel {
  /** super('<toolType>') 第一个参数 */
  readonly toolType: string;
  /** super() 第四个参数（如 '2.0.0'） */
  readonly toolVersion: string;
  /** 相对仓库根路径 */
  readonly sourceFile: string;
  readonly methods: readonly MethodDoc[];
  readonly dynamicWarnings: readonly string[];
}

/**
 * 收集 src 下全部 TS 源码文件（排除测试与声明文件）。
 * 全量发现（决策 5）：任何新增 BaseTool 子类自动纳入提取与 --check 强制。
 */
export function collectToolSourceFiles(srcDir: string): string[] {
  const collected: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts') || entry.name.endsWith('.d.ts')) continue;
      collected.push(fullPath);
    }
  };
  walk(srcDir);
  return collected.sort();
}

/** 从源码文件列表提取全部 BaseTool 子类的 ToolDocModel（按 toolType 排序，确定性输出） */
export function extractToolDocModels(files: readonly string[], repoRoot: string): ToolDocModel[] {
  const models: ToolDocModel[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const relativePath = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      if (!extendsBaseTool(statement, sourceFile)) continue;
      const model = extractFromClass(statement, sourceFile, relativePath);
      if (model) models.push(model);
    }
  }
  return models.sort((a, b) => a.toolType.localeCompare(b.toolType));
}

function extendsBaseTool(classDecl: ts.ClassDeclaration, sourceFile: ts.SourceFile): boolean {
  for (const clause of classDecl.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      if (type.expression.getText(sourceFile) === 'BaseTool') return true;
    }
  }
  return false;
}

function extractFromClass(
  classDecl: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  relativePath: string,
): ToolDocModel | undefined {
  const warnings: string[] = [];
  const superCall = findSuperCall(classDecl);
  if (!superCall) return undefined;

  const toolType = staticString(superCall.arguments[0]);
  if (!toolType) {
    warnings.push(`${relativePath}: super() toolType 非静态字符串，跳过该类`);
    return undefined;
  }
  const toolVersion = staticString(superCall.arguments[3]) ?? '1.0.0';

  const methods: MethodDoc[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isThisRegisterMethodCall(node)) {
      const method = extractMethod(node.arguments[0], relativePath, toolType, warnings);
      if (method) methods.push(method);
    }
    ts.forEachChild(node, visit);
  };
  visit(classDecl);

  return { toolType, toolVersion, sourceFile: relativePath, methods, dynamicWarnings: warnings };
}

function findSuperCall(classDecl: ts.ClassDeclaration): ts.CallExpression | undefined {
  for (const member of classDecl.members) {
    if (!ts.isConstructorDeclaration(member) || !member.body) continue;
    for (const statement of member.body.statements) {
      if (!ts.isExpressionStatement(statement)) continue;
      const expr = statement.expression;
      if (ts.isCallExpression(expr) && expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
        return expr;
      }
    }
  }
  return undefined;
}

function isThisRegisterMethodCall(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    && node.expression.name.text === 'registerMethod'
  );
}

function extractMethod(
  arg: ts.Expression | undefined,
  relativePath: string,
  toolType: string,
  warnings: string[],
): MethodDoc | undefined {
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    warnings.push(`${relativePath}: ${toolType} 存在非对象字面量 registerMethod 调用，已跳过`);
    return undefined;
  }
  const name = staticString(getProperty(arg, 'name'));
  if (!name) {
    warnings.push(`${relativePath}: ${toolType} 存在 name 非静态的 registerMethod 调用，已跳过`);
    return undefined;
  }

  const context = `${relativePath}: ${toolType}.${name}`;
  const description = staticString(getProperty(arg, 'description'));
  if (description === undefined) {
    warnings.push(`${context} 的 description 非静态字面量，该字段不生成（合并时保留现有值）`);
  }
  const summary = staticString(getProperty(arg, 'summary'));

  const isWriteExpr = getProperty(arg, 'isWrite');
  const isWrite = isWriteExpr === undefined ? false : staticBoolean(isWriteExpr);
  if (isWrite === undefined) {
    warnings.push(`${context} 的 isWrite 非静态字面量，按 false 处理`);
  }

  const parametersResult = extractParameters(getProperty(arg, 'parameters'), context, warnings);
  const { returnTypeName, returnsDescription } = extractReturns(getProperty(arg, 'returns'));

  return {
    name,
    description,
    summary,
    isWrite: isWrite ?? false,
    parameters: parametersResult.params,
    parametersDynamic: parametersResult.dynamic,
    returnTypeName,
    returnsDescription,
  };
}

function extractParameters(
  expr: ts.Expression | undefined,
  context: string,
  warnings: string[],
): { params: readonly ParamDoc[]; dynamic: boolean } {
  if (expr === undefined) return { params: [], dynamic: false };
  if (!ts.isObjectLiteralExpression(expr)) {
    warnings.push(`${context} 的 parameters 非静态对象字面量，该字段不生成（合并时保留现有值）`);
    return { params: [], dynamic: true };
  }

  // JSON-schema 形态（memory_service 实证）：{ type: 'object', properties: {...}, required: [...] }
  if (staticString(getProperty(expr, 'type')) === 'object' && getProperty(expr, 'properties') !== undefined) {
    return extractJsonSchemaParameters(expr, context, warnings);
  }

  // 扁平形态：{ paramName: { type, required, description, items?, properties? } }
  const params: ParamDoc[] = [];
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const paramName = propertyNameText(prop.name);
    if (paramName === undefined) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      warnings.push(`${context} 的参数 ${paramName} 非静态对象字面量，已跳过`);
      continue;
    }
    params.push(extractParam(paramName, prop.initializer, `${context} 的参数 ${paramName}`, warnings));
  }
  return { params, dynamic: false };
}

function extractJsonSchemaParameters(
  expr: ts.ObjectLiteralExpression,
  context: string,
  warnings: string[],
): { params: readonly ParamDoc[]; dynamic: boolean } {
  const propertiesExpr = getProperty(expr, 'properties');
  if (propertiesExpr === undefined || !ts.isObjectLiteralExpression(propertiesExpr)) {
    warnings.push(`${context} 的 parameters.properties 非静态对象字面量，该字段不生成（合并时保留现有值）`);
    return { params: [], dynamic: true };
  }
  const requiredNames = staticStringArray(getProperty(expr, 'required'));
  if (requiredNames === undefined && getProperty(expr, 'required') !== undefined) {
    warnings.push(`${context} 的 parameters.required 非静态字符串数组，按全部可选处理`);
  }
  const requiredSet = new Set(requiredNames ?? []);
  const params: ParamDoc[] = [];
  for (const prop of propertiesExpr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const paramName = propertyNameText(prop.name);
    if (paramName === undefined) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      warnings.push(`${context} 的参数 ${paramName} 非静态对象字面量，已跳过`);
      continue;
    }
    const doc = extractParam(paramName, prop.initializer, `${context} 的参数 ${paramName}`, warnings);
    // JSON-schema 形态的必填由父级 required 数组表达，覆盖 per-param 提取结果
    params.push({ ...doc, required: requiredSet.has(paramName) });
  }
  return { params, dynamic: false };
}

function staticStringArray(expr: ts.Expression | undefined): string[] | undefined {
  if (expr === undefined) return undefined;
  const unwrapped = unwrapExpression(expr);
  if (!ts.isArrayLiteralExpression(unwrapped)) return undefined;
  const values: string[] = [];
  for (const element of unwrapped.elements) {
    const value = staticString(element);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function extractParam(
  name: string,
  obj: ts.ObjectLiteralExpression,
  context: string,
  warnings: string[],
): ParamDoc {
  const type = staticString(getProperty(obj, 'type'));
  if (type === undefined) {
    warnings.push(`${context} 的 type 非静态字面量，按 'unknown' 处理`);
  }
  const required = staticBoolean(getProperty(obj, 'required')) ?? false;
  const description = staticString(getProperty(obj, 'description'));

  let children: readonly ParamDoc[] | undefined;
  const propertiesExpr = getProperty(obj, 'properties');
  if (propertiesExpr !== undefined) {
    if (ts.isObjectLiteralExpression(propertiesExpr)) {
      const nested: ParamDoc[] = [];
      for (const prop of propertiesExpr.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const childName = propertyNameText(prop.name);
        if (childName === undefined) continue;
        if (!ts.isObjectLiteralExpression(prop.initializer)) {
          warnings.push(`${context} 的子参数 ${childName} 非静态对象字面量，已跳过`);
          continue;
        }
        nested.push(extractParam(childName, prop.initializer, `${context} 的子参数 ${childName}`, warnings));
      }
      children = nested;
    } else {
      warnings.push(`${context} 的 properties 非静态对象字面量，嵌套结构不生成`);
    }
  }

  let item: ParamDoc | undefined;
  const itemsExpr = getProperty(obj, 'items');
  if (itemsExpr !== undefined) {
    if (ts.isObjectLiteralExpression(itemsExpr)) {
      item = extractParam('', itemsExpr, `${context} 的 items`, warnings);
    } else {
      warnings.push(`${context} 的 items 非静态对象字面量，元素类型不生成`);
    }
  }

  return { name, type: type ?? 'unknown', required, description, children, item };
}

const RETURN_TYPE_NAME_PATTERN = /[（(]\s*([A-Za-z][A-Za-z0-9_]*(?:\[\])?)\s*[)）]/;

function extractReturns(expr: ts.Expression | undefined): {
  returnTypeName?: string;
  returnsDescription?: string;
} {
  if (expr === undefined || !ts.isObjectLiteralExpression(expr)) return {};
  const properties = getProperty(expr, 'properties');
  if (properties === undefined || !ts.isObjectLiteralExpression(properties)) return {};
  const data = getProperty(properties, 'data');
  if (data === undefined || !ts.isObjectLiteralExpression(data)) return {};
  const dataDescription = staticString(getProperty(data, 'description'));
  if (dataDescription === undefined) return {};
  const match = RETURN_TYPE_NAME_PATTERN.exec(dataDescription);
  return {
    returnTypeName: match?.[1],
    returnsDescription: dataDescription,
  };
}

function getProperty(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propertyNameText(prop.name) === name) return prop.initializer;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticString(expr: ts.Expression | undefined): string | undefined {
  if (expr === undefined) return undefined;
  const unwrapped = unwrapExpression(expr);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  return undefined;
}

function staticBoolean(expr: ts.Expression | undefined): boolean | undefined {
  if (expr === undefined) return undefined;
  const unwrapped = unwrapExpression(expr);
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}
