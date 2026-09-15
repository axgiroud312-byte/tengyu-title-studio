export type Options = { provider: string; model: string; thinking: boolean | null; language: string; min_chars: number | null; max_chars: number | null; requirements: string; concurrency: number };
export type Settings = { base_url: string; models_url: string; workspace_id: string; defaults: Options; key_configured: boolean; credential_warning: string | null };
export type Model = { id: string; name: string; thinking: 'switchable' | 'on' | 'off' | 'unknown'; source: string };
export type LanguageCheck = { status: 'passed' | 'mismatch' | 'mixed' | 'uncertain' | 'unsupported' | 'unavailable'; requested: string; detected: string | null; confidence: number | null; message: string };
export type Item = { id: string; position: number; sku: string; image_path: string | null; fingerprint: string | null; status: string; title: string | null; raw?: string; char_count: number | null; language_check?: LanguageCheck | null; elapsed: number | null; error: string | null; input_error: string | null; warnings: string[]; attempts?: { id: number; status: string; raw: string; title: string; error: string; language_check?: LanguageCheck | null; char_count?: number | null; elapsed?: number; started_at: string }[] };
export type Counts = Record<string, number>;
export type Page = { items: Item[]; total: number; page: number; counts: Counts };
export type Scan = { id: string; mode: string; directory: string; total: number };
export type Batch = Scan & { created_at: string; status: string; processed: number; counts: Counts; options: Options; error: string | null; export_error: string | null; excel_path: string; exported_at: string | null; skill_version: string };
type Bridge = { bootstrap(): Promise<{ token: string }>; choose_directory(): Promise<string | null>; open_output(batch: string, directory: boolean): Promise<{ ok?: boolean; error?: string }> };
declare global { interface Window { pywebview?: { api: Bridge } } }

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: '本地服务连接异常，请重新打开程序。' }));
    throw new Error(data.errors?.map((e: { message: string }) => e.message).join('；') || data.detail || '操作未完成，请重试。');
  }
  return response.json();
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
    const response = await fetch('/api/session', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error('窗口连接失败，请重新打开程序。');
  }
  return api<Settings>('/settings');
}

export const defaults: Options = { provider: 'aliyun', model: 'qwen3.8-flash', thinking: false, language: '英语', min_chars: null, max_chars: null, requirements: '', concurrency: 3 };
export const statusText: Record<string, string> = { pending: '待处理', running: '生成中', completed: '已完成', review: '有风险', failed: '失败', unknown: '结果未知', ready: '待开始', paused: '已暂停', pausing: '正在收尾' };
