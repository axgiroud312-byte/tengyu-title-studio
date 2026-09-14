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
