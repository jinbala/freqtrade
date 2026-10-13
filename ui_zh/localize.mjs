// Translate the pinned FreqUI source before Vite compiles it. Never edit API identifiers.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || 'user_data/frequi-zh');
if (!process.argv.includes('--inventory')) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (revision !== 'f2d57c3efd55d9fb66e60b2dfc2e650b6b601185') throw new Error('Expected the official FreqUI 3.1.3 checkout.');
  execFileSync('git', ['restore', '--source=HEAD', '--', 'src', 'index.html'], { cwd: root });
}
const require = createRequire(path.join(root, 'package.json'));
const { parse: parseSfc } = require('@vue/compiler-sfc');
const { baseParse } = require('@vue/compiler-dom');
const ts = require('typescript');
const dictionaryPath = new URL('./zh-CN.tsv', import.meta.url);
const dictionary = fs.existsSync(dictionaryPath) ? Object.fromEntries(fs.readFileSync(dictionaryPath, 'utf8').split(/\r?\n/).filter((line) => line.includes('\t')).map((line) => { const split = line.indexOf('\t'); return [line.slice(0, split), line.slice(split + 1)]; })) : {};
const inventory = new Map();
const textProps = new Set(['label', 'header', 'key-header', 'key-headers', 'title', 'description', 'placeholder', 'aria-label', 'alt', 'text', 'message', 'hint', 'help', 'error', 'caption', 'empty', 'empty-text', 'emptyText', 'confirmText', 'cancelText']);
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const candidate = (text) => /[a-zA-Z]/.test(text) && !/[\u3400-\u9fff]/.test(text) && !/^(https?:|\/|@|i-mdi|mdi:|#[\da-fA-F])/.test(text);
const files = [];
function collect(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) collect(file);
    else if (/\.(vue|ts)$/.test(item.name) && !/\.(d|spec|test)\.ts$/.test(item.name)) files.push(file);
  }
}
collect(path.join(root, 'src'));

let replaced = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const edits = [];
  function translate(text, start, end, encode = (v) => v, kind = 'text') {
    const key = normalize(text);
    if (!candidate(key)) return;
    if (!inventory.has(key)) inventory.set(key, { key, kind, file: path.relative(root, file) });
    const value = dictionary[key];
    if (value == null) return;
    const prefix = text.match(/^\s*/)[0], suffix = text.match(/\s*$/)[0];
    edits.push({ start, end, value: encode(prefix + value + suffix) });
  }
  function script(source, offset, display = false) {
    const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    function protectedLiteral(node) {
      const parent = node.parent;
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isEnumMember(parent)) return true;
      if (ts.isElementAccessExpression(parent) || ts.isCaseClause(parent)) return true;
      if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
      if (ts.isPropertyAssignment(parent) && ['value', 'key', 'id', 'slot', 'to', 'field', 'accessorKey'].includes(parent.name.getText(ast).replace(/^['"]|['"]$/g, ''))) return true;
      if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return true;
      return false;
    }
    function isDisplay(node) {
      if (display) return true;
      for (let current = node.parent, depth = 0; current && depth < 5; current = current.parent, depth++) {
        if (ts.isPropertyAssignment(current) && textProps.has(current.name.getText(ast).replace(/^['"]|['"]$/g, ''))) return true;
      }
      return false;
    }
    function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !protectedLiteral(node)) {
        const text = node.text;
        if (isDisplay(node) || /\s/.test(text) || /^[A-Z]/.test(text)) {
          const quote = source[node.getStart(ast)];
          translate(text, offset + node.getStart(ast), offset + node.end, (v) => quote + v.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote).replaceAll('\n', '\\n') + quote, 'script');
        }
      } else if (ts.isTemplateExpression(node)) {
        for (const part of [node.head, ...node.templateSpans.map((span) => span.literal)]) {
          const text = part.text;
          if (candidate(text)) {
            const start = part.getStart(ast) + (part === node.head ? 1 : 1);
            const end = part.end - (part.kind === ts.SyntaxKind.TemplateTail ? 1 : 2);
            translate(text, offset + start, offset + end, (v) => v.replaceAll('`', '\\`'), 'fragment');
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  if (file.endsWith('.vue')) {
    const { descriptor } = parseSfc(original);
    for (const block of [descriptor.script, descriptor.scriptSetup]) if (block) script(block.content, block.loc.start.offset);
    if (descriptor.template) {
      const template = descriptor.template;
      const base = template.loc.start.offset;
      function walk(node) {
        if (node.type === 2) translate(node.content, base + node.loc.start.offset, base + node.loc.end.offset);
        if (node.type === 5) script(node.content.content, base + node.content.loc.start.offset, true);
        for (const prop of node.props || []) {
          if (prop.type === 6 && prop.value && textProps.has(prop.name)) {
            const quoted = prop.value.loc.source;
            translate(prop.value.content, base + prop.value.loc.start.offset, base + prop.value.loc.end.offset, (v) => quoted[0] + v.replaceAll('&', '&amp;').replaceAll(quoted[0], quoted[0] === '"' ? '&quot;' : '&#39;') + quoted[0], 'attribute');
          } else if (prop.type === 7 && prop.exp) {
            // Bindings that produce labels/items, not CSS, routes, model values, or predicates.
            const arg = prop.arg?.content;
            if (prop.name === 'bind' && (textProps.has(arg) || ['items', 'columns', 'options'].includes(arg))) script(prop.exp.content, base + prop.exp.loc.start.offset, true);
          }
        }
        for (const child of node.children || []) walk(child);
      }
      walk(baseParse(template.content));
    }
  } else script(original, 0);
  if (!process.argv.includes('--inventory')) {
    const seen = new Set();
    let result = original;
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
      if (seen.has(edit.start)) continue;
      seen.add(edit.start); replaced++;
      result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    }
    if (result !== original) fs.writeFileSync(file, result);
  }
}
if (!process.argv.includes('--inventory')) {
  // Runtime values are translated for display only; model values and API payloads remain original.
  fs.copyFileSync(new URL('./zhLocale.ts', import.meta.url), path.join(root, 'src/utils/zhLocale.ts'));
  fs.writeFileSync(path.join(root, 'src/utils/zhDictionary.json'), JSON.stringify(dictionary, null, 2));
  for (const file of files.filter((file) => file.endsWith('.vue'))) {
    const source = fs.readFileSync(file, 'utf8');
    const { descriptor } = parseSfc(source);
    if (!descriptor.template) continue;
    const base = descriptor.template.loc.start.offset;
    const edits = [];
    function wrap(node) {
      if (node.type === 5 && !node.content.content.trim().startsWith('zhDisplay(')) {
        edits.push({ start: base + node.content.loc.start.offset, end: base + node.content.loc.end.offset, value: `zhDisplay(${node.content.content})` });
      }
      for (const child of node.children || []) wrap(child);
    }
    wrap(baseParse(descriptor.template.content));
    let output = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
    output = output.replace(/<UTable(?=[\s>])/g, '<UTable :default-column="zhTableColumn"');
    output = output.replace(/<ECharts(?=[\s>])/g, '<ECharts :init-options="{ locale: \'ZH\' }"');
    if (output !== source) fs.writeFileSync(file, output);
  }
  function patch(relative, before, after) {
    const filename = path.join(root, relative), content = fs.readFileSync(filename, 'utf8');
    if (!content.includes(before)) throw new Error(`Missing patch target in ${relative}: ${before}`);
    fs.writeFileSync(filename, content.replaceAll(before, after));
  }
  patch('src/App.vue', '<script setup lang="ts">', '<script setup lang="ts">\nimport { zh_cn } from "@nuxt/ui/locale";');
  patch('src/App.vue', '<UApp>', '<UApp :locale="zh_cn">');
  patch('src/main.ts', "import App from './App.vue';", "import App from './App.vue';\nimport { registerLocale } from 'echarts/core';\nimport zhCharts from 'echarts/lib/i18n/langZH.js';\nregisterLocale('ZH', zhCharts);");
  patch('src/App.vue', 'Avenir, Helvetica, Arial, sans-serif', '"Microsoft YaHei", "PingFang SC", Avenir, Helvetica, Arial, sans-serif');
  patch('src/components/layout/NavBar.vue', "let title = 'freqUI';", "let title = 'FreqUI 中文版';");
  patch('src/utils/formatters/timeformat.ts', 'humanizeDuration(duration * 1000)', "humanizeDuration(duration * 1000, { language: 'zh_CN' })");
  patch('src/composables/percentageTool.ts', "{ units: ['d', 'h', 'm'] }", "{ units: ['d', 'h', 'm'], language: 'zh_CN' }");
  patch('src/components/BotLogin.vue', '/api/v1/ping to make sure the bot API is reachable', '/api/v1/ping，确认机器人 API 可以访问。');
  patch('src/stores/settings.ts', "const timezone = ref('UTC');", "const timezone = ref('Asia/Shanghai');");
  patch('src/pages/settings.vue', "const timezoneOptions = ['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone];", "const timezoneOptions = [...new Set(['Asia/Shanghai', 'UTC', Intl.DateTimeFormat().resolvedOptions().timeZone])];");
  patch('src/components/ftbot/ExchangeSelect.vue', '`${tm.margin_mode} ${tm.trading_mode}`', '`${zhDisplay(tm.margin_mode)} ${zhDisplay(tm.trading_mode)}`');
  patch('src/components/ftbot/PairlistConfigurator.vue', "ref<'Config' | 'Results'>('配置')", "ref<'Config' | 'Results'>('Config')");
  patch('src/components/ftbot/PairlistConfigurator.vue', "selectedView.value = '结果'", "selectedView.value = 'Results'");
  patch('src/components/ftbot/PairlistConfigurator.vue', "content: 'Drag pairlist here'", "content: '将交易对规则拖到这里'");
  patch('src/composables/useCandleChartTooltip.ts', "label: '持仓中'", "label: '开盘价'");
  // This upstream control is permanently disabled and causes a Vue TS6 narrowing error.
  const controlsPath = path.join(root, 'src/components/ftbot/BotControls.vue');
  fs.writeFileSync(controlsPath, fs.readFileSync(controlsPath, 'utf8').replace(/\s*<UButton\s+v-if="botStore.activeBot.isWebserverMode && false"[\s\S]*?\/>/, ''));
  patch('src/components/ftbot/BotPerformance.vue', 'field.formatter ? field.formatter(row.original[field.key]) : row.original[field.key]', 'field.formatter ? field.formatter(row.original[field.key]) : zhDisplay(row.original[field.key])');
  patch('src/components/ftbot/BacktestResultTablePer.vue', "Array.isArray(value) ? value[i] : value || item['exit_reason'] || '其他'", "zhDisplay(Array.isArray(value) ? value[i] : value || item['exit_reason'] || '其他')");
  patch('src/components/ftbot/BacktestResultTablePer.vue', "(value || item['exit_reason'] || '其他') as string", "zhDisplay(value || item['exit_reason'] || '其他') as string");
  patch('src/utils/notifications.ts', '${msg.direction}', '${zhDisplay(msg.direction)}');
  patch('src/utils/notifications.ts', '${msg.reason}', '${zhDisplay(msg.reason)}');
  patch('index.html', 'lang="en"', 'lang="zh-CN"');
  patch('index.html', '<title>FreqUI</title>', '<title>FreqUI 中文版</title>');
  const htmlPath = path.join(root, 'index.html');
  fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8').replace(/<noscript>[\s\S]*?<\/noscript>/, '<noscript><strong>FreqUI 需要启用 JavaScript 才能正常使用，请在浏览器中启用后继续。</strong></noscript>'));
}
const missing = [...inventory.values()].filter(({ key }) => dictionary[key] == null).sort((a, b) => a.key.localeCompare(b.key));
fs.writeFileSync(path.join(root, 'zh-missing.json'), JSON.stringify(missing, null, 2));
console.log(JSON.stringify({ files: files.length, uniqueTexts: inventory.size, replacements: replaced, untranslated: missing.length }));
