import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'admin/src');
const outputRoot = path.join(root, 'admin-go/internal/platform');
const files = fs.readdirSync(sourceRoot, { recursive: true })
  .filter((file) => file.endsWith('.ts')).sort();
const schemas = {};
const routes = [];
const permissions = {};
let constants = new Map();

function decorators(node) {
  return (ts.getDecorators(node) ?? []).map(({ expression }) => ({
    name: expression.expression?.getText(),
    args: [...(expression.arguments ?? [])],
  }));
}

function value(node) {
  if (!node) return null;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return value(node.expression);
  if (ts.isIdentifier(node) && constants.has(node.text)) return value(constants.get(node.text));
  if (ts.isBinaryExpression(node)) {
    const left = value(node.left);
    const right = value(node.right);
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
    if (node.operatorToken.kind === ts.SyntaxKind.SlashToken) return left / right;
    throw new Error(`Unsupported constant expression: ${node.getText()}`);
  }
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node)) return -Number(value(node.operand));
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(
    (property) => [property.name.getText().replace(/^['"]|['"]$/g, ''), value(property.initializer)],
  ));
  if (ts.isNewExpression(node)) return { instance: node.expression.getText() };
  return node.getText();
}

function get(decs, name) { return decs.find((item) => item.name === name); }
function permissionList(decs, name) {
  return get(decs, name)?.args.map((arg) => permissions[arg.getText()] ?? arg.getText());
}

function schemaFor(node) {
  if (!node.members.some((member) => decorators(member).some((d) => /^Is|^Validate/.test(d.name)))) return;
  const fields = node.members.filter(ts.isPropertyDeclaration).map((member) => {
    const decs = decorators(member);
    return {
      name: member.name.getText(),
      rules: decs.filter((d) => !['Type', 'Transform'].includes(d.name)).reverse()
        .map((d) => ({ name: d.name, args: d.args.map(value) })),
      ...(member.initializer ? { default: value(member.initializer) } : {}),
      ...(get(decs, 'Type') ? {
        transform: get(decs, 'Type').args[0].body.getText(),
      } : {}),
    };
  });
  if (!fields.some((field) => field.rules.length)) return;
  schemas[node.name.text] = {
    fields,
    ...(node.heritageClauses ? { extends: node.heritageClauses[0].types[0].expression.getText() } : {}),
  };
}

function controllerFor(node, file) {
  const classDecs = decorators(node);
  const controller = get(classDecs, 'Controller');
  if (!controller) return;
  for (const method of node.members.filter(ts.isMethodDeclaration)) {
    const decs = decorators(method);
    const http = decs.find((item) => ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head'].includes(item.name));
    if (!http) continue;
    const parameters = method.parameters.map((parameter) => ({
      decorators: decorators(parameter), type: parameter.type?.getText(),
    }));
    const route = {
      method: http.name.toUpperCase(),
      path: '/' + [value(controller.args[0]), value(http.args[0])].filter(Boolean).join('/'),
      controller: node.name.text, handler: method.name.getText(), source: file.replaceAll('\\', '/'),
      auth: (get(decs, 'UseGuards') ?? get(classDecs, 'UseGuards'))?.args.some(
        (arg) => arg.getText() === 'JwtAuthGuard',
      ) ?? false,
      permissions: permissionList(decs, 'RequirePermissions')
        ?? permissionList(classDecs, 'RequirePermissions') ?? [],
      anyPermissions: permissionList(decs, 'RequireAnyPermissions')
        ?? permissionList(classDecs, 'RequireAnyPermissions') ?? [],
      status: value(get(decs, 'HttpCode')?.args[0]) ?? (http.name === 'Post' ? 201 : 200),
      headers: Object.fromEntries(decs.filter((d) => d.name === 'Header').map((d) => d.args.map(value))),
    };
    for (const [decorator, property] of [['Body', 'bodyDto'], ['Query', 'queryDto']]) {
      const param = parameters.find((p) => get(p.decorators, decorator)?.args.length === 0);
      if (param?.type) route[property] = param.type;
    }
    route.uuidParams = parameters.flatMap((param) => {
      const dec = get(param.decorators, 'Param');
      return dec?.args.some((arg) => arg.getText().includes('ParseUUIDPipe')) ? [value(dec.args[0])] : [];
    });
    routes.push(route);
  }
}

const permissionSource = ts.createSourceFile('permissions.ts', fs.readFileSync(
  path.join(sourceRoot, 'common/rbac/permissions.ts'), 'utf8',
), ts.ScriptTarget.Latest, true);
for (const node of permissionSource.statements.filter(ts.isEnumDeclaration)) {
  for (const member of node.members) permissions[`${node.name.text}.${member.name.getText()}`] = value(member.initializer);
}
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(sourceRoot, file), 'utf8'), ts.ScriptTarget.Latest, true);
  constants = new Map(source.statements.filter(ts.isVariableStatement).flatMap((statement) =>
    statement.declarationList.declarations.map((declaration) => [declaration.name.getText(), declaration.initializer]),
  ));
  for (const node of source.statements.filter(ts.isClassDeclaration)) {
    schemaFor(node);
    controllerFor(node, file);
  }
}
routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
fs.mkdirSync(outputRoot, { recursive: true });
const content = JSON.stringify({ routes, schemas }, null, 2) + '\n';
const target = path.join(outputRoot, 'legacy-contract.json');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== content) throw new Error('Legacy contract changed; regenerate and review parity.');
} else fs.writeFileSync(target, content);
console.log(`${routes.length} HTTP routes, ${Object.keys(schemas).length} DTO schemas`);
