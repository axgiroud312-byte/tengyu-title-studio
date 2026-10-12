export type Options = { provider: string; model: string; thinking: boolean | null; language: string; min_chars: number | null; max_chars: number | null; requirements: string; concurrency: number };
export type Settings = { base_url: string; models_url: string; workspace_id: string; defaults: Options; key_configured: boolean; credential_warning: string | null };
export type Model = { id: string; name: string; thinking: 'switchable' | 'on' | 'off' | 'unknown'; source: string };
export type Item = { id: string; position: number; sku: string; image_path: string | null; fingerprint: string | null; status: string; title: string | null; raw?: string; char_count: number | null; elapsed: number | null; error: string | null; input_error: string | null; warnings: string[]; attempts?: { id: number; status: string; raw: string; title: string; error: string; elapsed?: number; started_at: string }[] };
export type Counts = Record<string, number>;
export type Page = { items: Item[]; total: number; page: number; counts: Counts };
export type Scan = { id: string; mode: string; directory: string; total: number };
export type Batch = Scan & { created_at: string; status: string; processed: number; counts: Counts; options: Options; error: string | null; export_error: string | null; excel_path: string; exported_at: string | null; skill_version: string };
type Bridge = { bootstrap(): Promise<{ token: string }>; choose_directory(): Promise<string | null>; open_output(batch: string, directory: boolean): Promise<{ ok?: boolean; error?: string }> };
declare global { interface Window { pywebview?: { api: Bridge } } }

async function request(path: string, init: RequestInit) {
  try { return await fetch(path, init); }
  catch { throw new Error('无法连接本地服务。请确认程序仍在运行，重新打开后查看批次状态。'); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: '本地服务返回异常。请重新打开程序后查看批次状态。' }));
    throw new Error(data.errors?.map((e: { message: string }) => e.message).join('；') || data.detail || '未能确认操作结果，请查看当前批次状态。');
  }
  try { return await response.json(); }
  catch { throw new Error('本地服务返回异常。请重新打开程序后查看批次状态。'); }
}

export async function connect() {
  const params = new URLSearchParams(location.hash.slice(1));
  let token = params.get('token');
  if (token) history.replaceState(null, '', location.pathname);
  if (!token && !window.pywebview) {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 800);
      window.addEventListener('pywebviewready', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
  }
  if (!token && window.pywebview) token = (await window.pywebview.api.bootstrap()).token;
  if (token) {
    const response = await request('/api/session', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error('窗口连接失败，请重新打开程序。');
  }
  return api<Settings>('/settings');
}

export const defaults: Options = { provider: 'aliyun', model: 'qwen3.8-flash', thinking: false, language: '英语', min_chars: null, max_chars: null, requirements: '', concurrency: 3 };
export const statusText: Record<string, string> = { pending: '待生成', running: '生成中', completed: '已生成', review: '需检查', failed: '生成失败', unknown: '结果未知' };
export const batchStatusText: Record<string, string> = { ready: '待开始', running: '生成中', paused: '已暂停', pausing: '正在暂停', completed: '处理结束' };
export const unknownResultHelp = '未收到完整结果，可能已计费。请查看详情后决定是否重新生成。';
