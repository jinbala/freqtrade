import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ui from '@nuxt/ui/vue-plugin';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parse } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';
import ts from 'typescript';
import { zhDisplay, zhTableColumn } from './utils/zhLocale';
import BotLogin from './components/BotLogin.vue';
import Settings from './pages/settings.vue';
import USegmentedControl from './components/general/USegmentedControl.vue';
import TimeframeSelect from './components/ftbot/TimeframeSelect.vue';

vi.mock('@iconify/vue', async (original) => ({
  ...await original<typeof import('@iconify/vue')>(),
  Icon: { template: '<span />' },
}));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); localStorage.clear(); });
async function render(component, options = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(component, { ...options, global: { plugins: [createPinia(), ui, router] } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('FreqUI 简体中文', () => {
  it('translates runtime states without mutating input data', () => {
    const input = { state: 'running', ordertype: 'market', pair: 'BTC/USDT' };
    expect(zhDisplay(input.state)).toBe('运行中');
    expect(zhDisplay(input.ordertype)).toBe('市价');
    expect(zhDisplay(input.pair)).toBe('BTC/USDT');
    expect(input).toEqual({ state: 'running', ordertype: 'market', pair: 'BTC/USDT' });
    expect(zhDisplay('BtcEmaCross')).toBe('BtcEmaCross');
    expect(zhDisplay(0)).toBe(0);
    expect(zhDisplay(true)).toBe('是');
  });

  it('translates default table cells including metric labels and exit reasons', () => {
    expect(zhTableColumn.cell({ getValue: () => 'force_exit' })).toBe('强制平仓');
    expect(zhTableColumn.cell({ getValue: () => 'Max Consecutive Wins / Loss' })).toBe('最大连续盈利／亏损笔数');
    expect(zhTableColumn.cell({ getValue: () => 12.35 })).toBe('12.35');
    expect(zhTableColumn.cell({ getValue: () => null })).toBe('');
  });

  it('renders the original login form in Chinese', async () => {
    const wrapper = await render(BotLogin);
    for (const label of ['机器人名称', 'API 地址', '用户名', '密码', '重置', '提交']) expect(wrapper.text()).toContain(label);
    expect(wrapper.text()).not.toMatch(/Bot Name|Username|Password|Submit|Reset/);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
  });

  it('renders settings sections and help text in Chinese', async () => {
    const wrapper = await render(Settings);
    for (const label of ['FreqUI 设置', '界面设置', '锁定动态布局', '显示时区', '图表设置', '通知设置', '回测设置']) expect(wrapper.text()).toContain(label);
    expect(wrapper.text()).not.toMatch(/Show open trades|Notification Settings|Chart settings/);
  });

  it('renders Chinese tab labels while retaining original model values', async () => {
    const wrapper = await render(USegmentedControl, { props: { items: [{ value: 'Config' }, { value: 'Results' }], labelKey: 'value', valueKey: 'value', modelValue: 'Config' } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map((b) => b.text())).toEqual(['配置', '结果']);
    await buttons[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Results']);
  });

  it('retains exchange timeframe identifiers behind Chinese option labels', async () => {
    const source = readFileSync('src/components/ftbot/TimeframeSelect.vue', 'utf8');
    expect(source).toContain("{ value: '5m', label: '5 分钟' }");
    expect(source).toContain("{ value: '1M', label: '1 个月' }");
    const wrapper = await render(TimeframeSelect);
    expect(wrapper.text()).toContain('使用策略默认值');
  });

  it('keeps all literal API routes and model option values identical to upstream', () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const file = join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(vue|ts)$/.test(file) && !/\.(d|spec|test)\.ts$/.test(file)) files.push(file); } };
    walk('src');
    let checked = 0;
    function values(source: string, file: string) {
      const blocks = file.endsWith('.vue') ? (() => { const { descriptor } = parse(source); return [descriptor.script?.content, descriptor.scriptSetup?.content, ...((descriptor.template && (() => { const expressions: string[] = []; function scan(node) { for (const prop of node.props || []) if (prop.type === 7 && prop.exp) expressions.push(prop.exp.content); for (const child of node.children || []) scan(child); } scan(baseParse(descriptor.template.content)); return expressions; })()) || [])].filter(Boolean); })() : [source];
      const output: string[] = [];
      for (const block of blocks) {
        const ast = ts.createSourceFile(file, block!, ts.ScriptTarget.Latest, true);
        function visit(node: ts.Node) {
          if (ts.isStringLiteral(node)) {
            const parent = node.parent;
            const option = ts.isPropertyAssignment(parent) && ['value', 'key', 'id', 'slot', 'to', 'field', 'accessorKey'].includes(parent.name.getText(ast).replace(/^['"]|['"]$/g, ''));
            const route = /^\/(api|trade|backtest|settings|dashboard|graph|logs|login|download_data|pairlist|open_trades)/.test(node.text);
            if (option || route) output.push(node.text);
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
      return output;
    }
    const sourceFiles = files.filter((file) => !file.includes('zhLocale'));
    const batch = execFileSync('git', ['cat-file', '--batch'], {
      input: sourceFiles.map((file) => `HEAD:${file.replaceAll('\\', '/')}`).join('\n') + '\n', maxBuffer: 20 * 1024 * 1024,
    });
    let cursor = 0;
    for (const file of sourceFiles) {
      const headerEnd = batch.indexOf(10, cursor);
      const size = Number(batch.subarray(cursor, headerEnd).toString().split(' ').at(-1));
      const original = batch.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8');
      cursor = headerEnd + size + 2;
      expect(values(readFileSync(file, 'utf8'), file), file).toEqual(values(original, file));
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  }, 30000);
});
