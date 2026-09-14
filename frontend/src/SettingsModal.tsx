import { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { api, type Settings } from './api';
import { Btn, Modal, TextInput } from './ui';

export default function SettingsModal({ settings, onClose, onSaved }: { settings: Settings; onClose(): void; onSaved(s: Settings): void }) {
  const [draft, setDraft] = useState(settings);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError('');
    try {
      const { key_configured: _configured, credential_warning: _warning, ...body } = draft;
      const result = await api<Settings>('/settings', 'PUT', { ...body, ...(key.trim() ? { api_key: key.trim() } : {}) });
      setKey(''); onSaved(result); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title="服务设置" description="API Key 保存在系统凭据管理器中，不会写入 Excel 或任务记录。">
    <form onSubmit={e => { e.preventDefault(); void save(); }} className="settings-form">
      <div className="credential-banner">{settings.key_configured ? <CheckCircle2 size={20}/> : <KeyRound size={20}/>}<div><strong>{settings.key_configured ? '阿里云密钥已配置' : '连接你的阿里云账号'}</strong><p>模型请求使用你的账号额度，按实际调用计费。</p></div></div>
      <div className="field"><label htmlFor="api-key">API Key</label><TextInput id="api-key" type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={settings.key_configured ? '留空保留现有密钥' : '粘贴阿里云 API Key'}/></div>
      <div className="field"><label htmlFor="base-url">生成服务地址</label><TextInput id="base-url" value={draft.base_url} onChange={e => setDraft({ ...draft, base_url: e.target.value })}/><p className="field-help">API Key 需要与服务地域、业务空间一致。</p></div>
      <div className="field"><label htmlFor="workspace">业务空间 ID <span className="optional">选填</span></label><TextInput id="workspace" value={draft.workspace_id} onChange={e => setDraft({ ...draft, workspace_id: e.target.value })} placeholder="北京地域刷新模型目录时使用"/></div>
      <div className="field"><label htmlFor="models-url">模型目录地址 <span className="optional">高级选项</span></label><TextInput id="models-url" value={draft.models_url} onChange={e => setDraft({ ...draft, models_url: e.target.value })} placeholder="留空按服务地址 / 业务空间确定"/></div>
      <div className="field"><label htmlFor="concurrency">同时处理数量</label><TextInput id="concurrency" type="number" min={1} max={10} value={draft.defaults.concurrency} onChange={e => setDraft({ ...draft, defaults: { ...draft.defaults, concurrency: Number(e.target.value) } })}/><p className="field-help">默认 3，范围 1～10；对新批次生效。</p></div>
      {(error || settings.credential_warning) && <p className="error-message" role="alert">{error || settings.credential_warning}</p>}
      <div className="modal-actions"><Btn onClick={onClose} type="button">取消</Btn><Btn primary type="submit" disabled={busy}>{busy ? '保存中…' : '保存设置'}</Btn></div>
    </form>
  </Modal>;
}
