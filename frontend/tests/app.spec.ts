import { test, expect } from '@playwright/test';

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
    await expect(page.getByRole('button', { name: '选择商品目录', exact: true })).toBeInViewport();
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

test('扫描按钮发送正确目录模式，缺少密钥时打开设置', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '图片目录' }).click();
  await page.getByRole('textbox', { name: '目录路径' }).fill('C:\\商品图片');
  const request = page.waitForRequest(r => r.url().endsWith('/api/scans') && r.method() === 'POST');
  await page.getByRole('button', { name: '扫描商品' }).click();
  expect((await request).postDataJSON()).toEqual({ mode: 'images', directory: 'C:\\商品图片' });
  await expect(page.getByRole('cell', { name: '001', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '002', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始生成 · 2 项' }).click();
  await expect(page.getByRole('dialog', { name: '服务设置' })).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type','password');
});

test('风险标题保留原因，可筛选查看，只有点击重新生成才发请求', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const reason = '17 字符，少于要求的 200；语言不符：要求西班牙语，识别为英语。';
  const languageCheck = { status: 'mismatch', requested: '西班牙语', detected: '英语', confidence: 0.96, message: '语言不符：要求西班牙语，识别为英语。' };
  const batch = { id: 'risk-batch', mode: 'images', directory: 'C:\\商品图片', total: 2, created_at: '2026-09-15T00:00:00Z', status: 'completed', processed: 2, counts: { review: 1, completed: 1, pending: 0 }, options: { ...options, language: '西班牙语', min_chars: 200, max_chars: 220 }, error: null, export_error: null, exported_at: null, excel_path: 'C:\\商品图片\\标题.xlsx', skill_version: 'test' };
  const items = ['001', '002'].map((sku, i) => ({ id: sku, sku, position: i, image_path: null, fingerprint: null, status: i === 0 ? 'review' : 'completed', title: i === 0 ? 'Blue floral scarf' : 'Título anterior', raw: 'Blue floral scarf', char_count: i === 0 ? 17 : 15, language_check: i === 0 ? languageCheck : null, elapsed: 1, error: i === 0 ? reason : null, input_error: null, warnings: [] }));
  const retries: unknown[] = [];
  await page.route('**/api/batches**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/batches') return route.fulfill({ json: [batch] });
    if (url.pathname.endsWith('/retry')) {
      retries.push(route.request().postDataJSON());
      return route.fulfill({ json: batch });
    }
    if (url.pathname.endsWith('/items')) {
      const rows = url.searchParams.get('status') === 'review' ? items.slice(0, 1) : items;
      return route.fulfill({ json: { items: rows, total: rows.length, page: 1, counts: batch.counts } });
    }
    if (url.pathname.endsWith('/items/001')) return route.fulfill({ json: { ...items[0], attempts: [{ id: 1, status: 'review', raw: items[0].raw, error: reason, language_check: languageCheck }] } });
    if (url.pathname.endsWith('/items/002')) return route.fulfill({ json: items[1] });
    return route.fulfill({ json: batch });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '历史批次', exact: true }).click();
  await page.getByRole('dialog', { name: '历史批次' }).getByRole('button', { name: /商品图片/ }).click();
  await expect(page.getByRole('cell', { name: '有风险', exact: true })).toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览 002' }).click();
  await expect(page.getByText('此历史标题尚未进行语言检查。')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^有风险/ }).click();
  await expect(page.getByRole('cell', { name: '002', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '预览 001' }).click();
  const detail = page.getByRole('dialog', { name: '001', exact: true });
  await expect(detail.getByText('Blue floral scarf', { exact: true }).first()).toBeVisible();
  await detail.getByText('第 1 次请求 · 有风险 · 原始结果', { exact: true }).click();
  await expect(detail.locator('pre')).toHaveText('Blue floral scarf');
  await page.keyboard.press('Escape');
  expect(retries).toEqual([]);
  await page.getByRole('checkbox', { name: '选择 001', exact: true }).check();
  await page.getByRole('button', { name: '重新生成 1 项', exact: true }).click();
  await expect.poll(() => retries.length).toBe(1);
  expect(retries[0]).toEqual({ item_ids: ['001'] });
});
