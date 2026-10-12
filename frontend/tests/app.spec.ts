import { test, expect, type Page } from '@playwright/test';
import type { Batch, Item } from '../src/api';

const options = { provider: 'aliyun', model: 'qwen3.8-flash', thinking: false, language: '英语', min_chars: null, max_chars: null, requirements: '', concurrency: 3 };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings') return route.fulfill({ json: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models_url: '', workspace_id: '', defaults: options, key_configured: false, credential_warning: null } });
    if (path === '/api/providers/aliyun/models') return route.fulfill({ json: { models: [{ id: 'qwen3.8-flash', name: 'qwen3.8-flash', thinking: 'switchable', source: 'preset' }] } });
    if (path === '/api/scans') return route.fulfill({ json: { id: 'sample-scan', mode: 'images', directory: 'C:\\商品图片', total: 2 } });
    if (path === '/api/scans/sample-scan/items') return route.fulfill({ json: { total: 2, page: 1, counts: { pending: 2 }, items: ['001','002'].map((sku,i) => ({ id: sku, sku, position:i, image_path: null, fingerprint: null, status:'pending', title:null, raw:null, char_count:null, elapsed:null, error:null, input_error:null, warnings:[] })) } });
    if (path === '/api/skill') return route.fulfill({ json: { text: '通用标题规则：不编造商品事实。' } });
    return route.fulfill({ status: 400, json: { detail: '此界面测试不会调用模型' } });
  });
});

for (const [width,height] of [[1366,768],[1920,1080],[1092,614],[910,512]]) {
  test(`主要操作在 ${width}x${height} 可见`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '选择商品文件夹', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    if (width < 1100) {
      await page.getByRole('button', { name: '生成设置', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('combobox', { name: '目标语言' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });
}

test('扫描按钮发送正确文件夹模式，缺少密钥时打开设置', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await expect(page.locator('.task-footer')).toContainText('请选择商品文件夹');
  await page.getByRole('tab', { name: '按图片', exact: true }).click();
  await page.getByRole('textbox', { name: '文件夹路径' }).fill('C:\\商品图片');
  await expect(page.locator('.task-footer')).toContainText('请扫描商品');
  const request = page.waitForRequest(r => r.url().endsWith('/api/scans') && r.method() === 'POST');
  await page.getByRole('button', { name: '扫描商品' }).click();
  expect((await request).postDataJSON()).toEqual({ mode: 'images', directory: 'C:\\商品图片' });
  await expect(page.getByRole('cell', { name: '001', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '002', exact: true })).toBeVisible();
  await expect(page.locator('.task-footer')).toContainText('请配置 API 密钥');
  await page.getByRole('button', { name: '开始生成 · 2 个商品' }).click();
  await expect(page.getByRole('dialog', { name: '服务设置' })).toBeVisible();
  await expect(page.getByLabel('API Key（密钥）', { exact: true })).toHaveAttribute('type','password');
});

const makeItem = (id: string, status: string): Item => ({
  id, sku: id, position: Number(id), image_path: null, fingerprint: null, status,
  title: status === 'completed' ? '已生成的商品标题' : null,
  char_count: status === 'completed' ? 8 : null, elapsed: null,
  error: status === 'failed' ? '模型请求失败' : null, input_error: null, warnings: [],
});

function makeBatch(items: Item[]): Batch {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return {
    id: 'sample-batch', mode: 'images', directory: 'C:\\商品图片', total: items.length,
    created_at: '2026-10-07T08:00:00Z', status: 'completed', processed: items.length,
    counts, options, error: null, export_error: null, excel_path: '', exported_at: null,
    skill_version: 'test',
  };
}

async function openHistoryBatch(page: Page, items: Item[]) {
  let batch = makeBatch(items);
  const retryRequests: unknown[] = [];
  await page.route('**/api/batches**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/batches') return route.fulfill({ json: [batch] });
    if (url.pathname === '/api/batches/sample-batch/items') {
      const status = url.searchParams.get('status');
      const filtered = status === 'all' ? items : items.filter(item => item.status === status);
      return route.fulfill({ json: { items: filtered, total: filtered.length, page: 1, counts: batch.counts } });
    }
    if (url.pathname === '/api/batches/sample-batch/export') {
      batch = { ...batch, exported_at: '2026-10-07T08:01:00Z', excel_path: 'C:\\商品图片\\标题.xlsx' };
      return route.fulfill({ json: batch });
    }
    if (url.pathname === '/api/batches/sample-batch/retry') {
      retryRequests.push(route.request().postDataJSON());
      return route.fulfill({ json: batch });
    }
    const item = items.find(value => url.pathname === `/api/batches/sample-batch/items/${value.id}`);
    return route.fulfill({ json: item || batch });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '历史批次', exact: true }).click();
  await page.getByRole('dialog', { name: '历史批次', exact: true }).getByRole('button', { name: /商品图片/ }).click();
  await expect(page.getByRole('cell', { name: items[0].sku, exact: true })).toBeVisible();
  return { retryRequests };
}

test('连接尚未完成和连接失败时不显示准备就绪', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/settings', async route => {
    await pending;
    return route.fulfill({ status: 503, json: { detail: '本地服务暂不可用' } });
  });
  await page.goto('/');
  await expect(page.locator('.connection')).toHaveText('正在连接…');
  await expect(page.getByText('准备就绪', { exact: true })).toHaveCount(0);
  release();
  await expect(page.locator('.connection')).toHaveText('连接失败');
  await expect(page.getByRole('alert')).toContainText('本地服务暂不可用');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeDisabled();
});

test('仅扫描后新建批次不承诺历史记录已保存', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '文件夹路径' }).fill('C:\\商品图片');
  await page.getByRole('button', { name: '扫描商品', exact: true }).click();
  await expect(page.getByRole('cell', { name: '001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新批次', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已清空扫描结果，请重新扫描商品。');
  await expect(page.getByText(/原批次可在/)).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '001', exact: true })).toHaveCount(0);
});

test('商品列表区分加载中、加载失败和成功后的筛选空态', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let recovered = false;
  await page.route('**/api/scans/sample-scan/items?*', async route => {
    await pending;
    return recovered
      ? route.fulfill({ json: { total: 0, page: 1, counts: {}, items: [] } })
      : route.fulfill({ status: 503, json: { detail: '读取商品失败，请重试。' } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '文件夹路径' }).fill('C:\\商品图片');
  await page.getByRole('button', { name: '扫描商品', exact: true }).click();
  await expect(page.locator('.table-scroll').getByText('正在加载商品…', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合当前筛选条件的商品。', { exact: true })).toHaveCount(0);
  release();
  await expect(page.locator('.table-scroll').getByText('商品加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合当前筛选条件的商品。', { exact: true })).toHaveCount(0);
  recovered = true;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('没有符合当前筛选条件的商品。', { exact: true })).toBeVisible();
  await expect(page.locator('.table-scroll').getByText('商品加载失败', { exact: true })).toHaveCount(0);
});

test('结果未知独立计数、筛选并说明可能已计费', async ({ page }) => {
  await openHistoryBatch(page, [makeItem('001', 'failed'), makeItem('002', 'unknown')]);
  const failedFilter = page.getByRole('button', { name: /^生成失败\s*1$/ });
  const unknownFilter = page.getByRole('button', { name: /^结果未知\s*1$/ });
  await expect(failedFilter).toBeVisible();
  await expect(unknownFilter).toBeVisible();
  await failedFilter.click();
  await expect(page.getByRole('cell', { name: '001', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '002', exact: true })).toHaveCount(0);
  await unknownFilter.click();
  await expect(page.getByRole('cell', { name: '002', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '001', exact: true })).toHaveCount(0);
  await expect(page.getByText('未收到完整结果，可能已计费。请查看详情后决定是否重新生成。', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '预览 002', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('结果未知');
});

test('全失败批次显示处理结束，导出前后按钮符合真实动作', async ({ page }) => {
  await openHistoryBatch(page, [makeItem('001', 'failed'), makeItem('002', 'failed')]);
  await expect(page.locator('.results-heading')).toContainText('处理结束');
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(0);
  await expect(page.locator('.results-heading')).toContainText('生成失败 2');
  await page.getByRole('button', { name: '导出当前结果', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新导出 Excel', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 Excel', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Excel 已保存至商品文件夹：标题.xlsx');
});

test('选择成功商品后先说明清空和费用，点击重新生成才请求模型任务', async ({ page }) => {
  await page.setViewportSize({ width: 910, height: 512 });
  const { retryRequests } = await openHistoryBatch(page, [makeItem('001', 'completed')]);
  await page.getByRole('checkbox', { name: '选择 001', exact: true }).check();
  expect(await page.locator('.table-scroll').evaluate(element => element.clientHeight)).toBeGreaterThan(80);
  await page.getByRole('cell', { name: '001', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('cell', { name: '001', exact: true })).toBeInViewport();
  await expect(page.getByText('将清空所选商品的当前标题并重新生成，可能产生新的费用。历史结果保留。', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', { name: '重新生成 1 个商品', exact: true });
  await expect(retry).toBeEnabled();
  expect(retryRequests).toEqual([]);
  const request = page.waitForRequest(r => r.url().endsWith('/api/batches/sample-batch/retry'));
  await retry.click();
  expect((await request).postDataJSON()).toEqual({ item_ids: ['001'] });
  await expect(retry).toHaveCount(0);
  expect(retryRequests).toEqual([{ item_ids: ['001'] }]);
});
