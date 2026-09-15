import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { ArrowDownToLine, ArrowRight, ChevronLeft, ChevronRight, FileSpreadsheet, FolderOpen, History, Image as ImageIcon, ListFilter, Pause, Play, Plus, RefreshCw, Settings as SettingsIcon, Settings2, Sparkles, X } from 'lucide-react';
import { api, connect, defaults, statusText, type Batch, type Item, type Model, type Options, type Page, type Scan, type Settings } from './api';
import { Btn, cn, Modal, TextInput, Tick } from './ui';
import OptionsPanel from './OptionsPanel';
import SettingsModal from './SettingsModal';

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<Options>(defaults);
  const [models, setModels] = useState<Model[]>([]);
  const [mode, setMode] = useState('sku');
  const [directory, setDirectory] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [data, setData] = useState<Page>({ items: [], total: 0, page: 1, counts: {} });
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [skill, setSkill] = useState<string | null>(null);
  const [history, setHistory] = useState<Batch[] | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const scope = batch ? { kind: 'batch', id: batch.id, total: batch.total } : scan ? { kind: 'scan', id: scan.id, total: scan.total } : null;
  const active = batch?.status === 'running' || batch?.status === 'pausing';
  const count = scope?.total || 0;
  const progress = batch?.total ? Math.round(batch.processed / batch.total * 100) : 0;

  useEffect(() => {
    let disposed = false;
    connect().then(async s => {
      const m = await api<{ models: Model[] }>('/providers/aliyun/models');
      if (!disposed) { setSettings(s); setOptions(s.defaults); setModels(m.models); }
    }).catch(e => !disposed && setError(e.message));
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!scope) { setData({ items: [], total: 0, page: 1, counts: {} }); return; }
    let disposed = false, loading = false;
    const current = scope;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await api<Page>(`/${current.kind === 'batch' ? 'batches' : 'scans'}/${current.id}/items?status=${filter}&page=${page}`);
        const summary = current.kind === 'batch' ? await api<Batch>(`/batches/${current.id}`) : null;
        if (!disposed) { setData(result); if (summary) setBatch(summary); }
      } catch (e) { if (!disposed) setError((e as Error).message); }
      finally { loading = false; }
    };
    void refresh();
    const timer = active ? setInterval(() => void refresh(), 1000) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [scope?.id, filter, page, active, busy]);

  async function perform(name: string, work: () => Promise<void>) {
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  async function chooseDirectory() {
    if (window.pywebview) {
      await perform('directory', async () => { const path = await window.pywebview!.api.choose_directory(); if (path) { resetResults(); setDirectory(path); } });
    } else { pathInput.current?.focus(); setNotice('浏览器预览模式：请在路径栏粘贴本机目录。Windows 桌面版会打开文件夹选择框。'); }
  }

  function resetResults() { setScan(null); setBatch(null); setSelected(new Set()); setPage(1); setFilter('all'); }
  async function doScan() {
    await perform('scan', async () => {
      const result = await api<Scan>('/scans', 'POST', { directory, mode });
      resetResults(); setScan(result); setDirectory(result.directory);
      if (!result.total) setNotice('此目录没有找到商品。请检查目录模式和图片所在层级。');
    });
  }

  async function start() {
    if (!settings?.key_configured) { setShowSettings(true); return; }
    await perform('start', async () => {
      let target = batch;
      if (!target && scan) {
        const { key_configured: _key, credential_warning: _warning, ...saved } = settings;
        setSettings(await api<Settings>('/settings', 'PUT', { ...saved, defaults: options }));
        target = await api<Batch>('/batches', 'POST', { scan_id: scan.id, options }); setBatch(target);
      }
      if (target) { setBatch(await api<Batch>(`/batches/${target.id}/start`, 'POST')); setSelected(new Set()); }
    });
  }

  async function action(name: 'pause' | 'retry' | 'export') {
    if (!batch) return;
    await perform(name, async () => {
      const result = await api<Batch>(`/batches/${batch.id}/${name}`, 'POST', name === 'retry' ? { item_ids: [...selected] } : undefined);
      setBatch(result); if (name === 'retry') setSelected(new Set());
      if (name === 'export' && !result.export_error) setNotice('Excel 已保存到所选目录。');
    });
  }

  async function openOutput(folder = false) {
    if (!batch) return;
    await perform('open', async () => {
      if (window.pywebview) { const result = await window.pywebview.api.open_output(batch.id, folder); if (result.error) throw new Error(result.error); }
      else if (folder) setNotice(`输出目录：${batch.directory}`);
      else { const anchor = document.createElement('a'); anchor.href = `/api/batches/${batch.id}/excel`; anchor.click(); }
    });
  }

  const imageUrl = (item: Item) => scope ? `/api/images/${scope.kind}/${scope.id}/${item.id}` : '';
  const eligible = (item: Item) => !item.input_error && !['running', 'pending'].includes(item.status);
  const selectable = data.items.filter(eligible);
  const selectItem = (id: string, checked: boolean) => setSelected(old => { const next = new Set(old); checked ? next.add(id) : next.delete(id); return next; });
  const optionsPanel = <OptionsPanel value={options} onChange={setOptions} models={models} locked={!!batch || !!busy} refreshing={busy === 'models'}
    onRefresh={() => void perform('models', async () => { const result = await api<{ models: Model[] }>('/providers/aliyun/models/refresh', 'POST'); setModels(result.models); setNotice(`已更新 ${result.models.length} 个可用视觉型号。目录不代表账号已开通。`); })}
    onSkill={() => void perform('skill', async () => setSkill((await api<{ text: string }>('/skill')).text))}/>;

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark"><Sparkles size={23}/></div><div><h1>腾域 <span>ai 写标题</span></h1><p>跨境电商 · 批量标题工作台</p></div></div>
      <div className="header-actions"><span className={cn('connection', settings?.key_configured && 'configured')}><span/>{settings?.key_configured ? '密钥已配置' : '待配置密钥'}</span><Btn disabled={active || !!busy} onClick={() => void perform('history', async () => setHistory(await api<Batch[]>('/batches')))}><History size={16}/>历史批次</Btn><Btn disabled={active || !settings} onClick={() => setShowSettings(true)}><SettingsIcon size={16}/>设置</Btn></div>
    </header>
    <main className="workspace"><section className="directory-card">
      <div className="directory-heading"><div><span className="eyebrow">开始你的标题任务</span><h2>把商品图片，变成上架标题。</h2></div><span className="output-pill"><FileSpreadsheet size={15}/>货号 + 标题 · Excel</span></div>
      <div className="directory-controls"><Tabs.Root value={mode} onValueChange={v => { if (!active) { setMode(String(v)); resetResults(); } }} className="mode-tabs"><Tabs.List className="segment-list" aria-label="目录模式"><Tabs.Tab value="sku" disabled={active} className="segment"><FolderOpen size={16}/>货号目录</Tabs.Tab><Tabs.Tab value="images" disabled={active} className="segment"><ImageIcon size={16}/>图片目录</Tabs.Tab></Tabs.List></Tabs.Root>
        <div className="path-input"><FolderOpen size={17}/><TextInput ref={pathInput} aria-label="目录路径" placeholder={mode === 'sku' ? '选择包含多个货号文件夹的总目录' : '选择存放商品图片的目录'} value={directory} title={directory} disabled={active || !!busy} onChange={e => { setDirectory(e.target.value); resetResults(); }}/></div>
        <Btn disabled={active || !!busy} onClick={() => void chooseDirectory()}>选择目录</Btn><Btn className="scan-btn" disabled={!directory.trim() || active || !!busy || !settings} onClick={() => void doScan()}>{busy === 'scan' ? '扫描中…' : '扫描商品'}<ArrowRight size={15}/></Btn>
      </div>
      <div className="directory-caption"><span>{mode === 'sku' ? '每个一级货号文件夹取自然排序的第一张图片' : '每张图片生成一个标题，文件名去掉后缀作为货号'}</span>{scope && <span className="output-path" title={directory}>已发现 {count} 个商品 · 输出到当前目录</span>}</div>
    </section>
    <div className="mobile-options"><Btn onClick={() => setShowOptions(true)}><Settings2 size={16}/>生成设置</Btn><span>{options.language} · {options.model}</span></div>
    {(error || notice || batch?.error || batch?.export_error) && <div className={cn('message-bar', (error || batch?.export_error || batch?.error) && 'message-error')} role={error ? 'alert' : 'status'}><span>{error || batch?.export_error || batch?.error || notice}</span>{(error || notice) && <button className="icon-btn" aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><X size={16}/></button>}</div>}
    <div className="work-grid"><aside className="desktop-options">{optionsPanel}</aside><section className="results-panel">
      <div className="results-heading"><div><h2>商品与标题 <span className="count-badge">{count}</span></h2><p>{batch ? `批次 ${batch.id.slice(0, 6)} · ${statusText[batch.status] || batch.status}` : '先确认商品图片，再开始批量生成'}</p></div>{scope && <Btn className="text-btn" disabled={active || !!busy} onClick={() => { resetResults(); setNotice('已回到新批次。原批次可在历史记录中查看。'); }}><Plus size={15}/>新批次</Btn>}</div>
      <div className="filter-bar"><ListFilter size={15}/>{[['all','全部'],['pending','待处理'],['completed','完成'],['review','有风险'],['failed','失败']].map(([id,label]) => <button key={id} className={cn('filter-btn', filter === id && 'is-active')} onClick={() => { setFilter(id); setPage(1); }} aria-pressed={filter === id}>{label}{id !== 'all' && (data.counts[id] || (id === 'failed' && data.counts.unknown)) ? <span>{(data.counts[id] || 0) + (id === 'failed' ? data.counts.unknown || 0 : 0)}</span> : null}</button>)}<span className="filter-hint">点击商品查看详情</span></div>
      {!scope ? <div className="empty-state"><div className="empty-art"><div className="art-sheet"><span/><span/><span/><FileSpreadsheet size={31}/></div><div className="art-folder"><FolderOpen size={56} strokeWidth={1.3}/></div><div className="art-spark"><Sparkles size={19}/></div></div><h3>从一个商品目录开始</h3><p>选好图片、设定语言，剩下的交给腾域。<br/>生成结果自动整理为两列 Excel 表格。</p><Btn primary onClick={() => void chooseDirectory()}><FolderOpen size={17}/>选择商品目录</Btn><div className="empty-steps"><span>01 选择目录</span><ArrowRight size={13}/><span>02 生成标题</span><ArrowRight size={13}/><span>03 导出 Excel</span></div></div>
        : <><div className="table-scroll"><table className="result-table"><thead><tr><th className="check-col"><Tick label="选择本页可重试项目" checked={selectable.length > 0 && selectable.every(i => selected.has(i.id))} disabled={active || !selectable.length} onChange={v => setSelected(old => { const next = new Set(old); selectable.forEach(i => v ? next.add(i.id) : next.delete(i.id)); return next; })}/></th><th className="image-col">图片</th><th className="sku-col">货号</th><th>生成标题</th><th className="chars-col">字符</th><th className="status-col">状态</th></tr></thead><tbody>
          {data.items.map(item => <tr key={item.id} className={cn(selected.has(item.id) && 'selected-row')}><td><Tick label={`选择 ${item.sku}`} checked={selected.has(item.id)} disabled={active || !eligible(item)} onChange={v => selectItem(item.id,v)}/></td><td><button className="thumbnail" aria-label={`预览 ${item.sku}`} onClick={() => void perform('detail', async () => setDetail(batch ? await api<Item>(`/batches/${batch.id}/items/${item.id}`) : item))}>{item.fingerprint ? <img src={imageUrl(item)} alt={item.sku} loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/>: <ImageIcon size={21}/>}</button></td><td><strong className="sku-text" title={item.sku}>{item.sku}</strong>{item.warnings.length > 0 && <span className="duplicate-label" title={item.warnings.join('；')}>货号重复</span>}</td><td><button className="title-cell" onClick={() => void perform('detail', async () => setDetail(batch ? await api<Item>(`/batches/${batch.id}/items/${item.id}`) : item))}>{item.title ? <span className="line-clamp-2">{item.title}</span> : <span className="title-placeholder">{item.status === 'running' ? '正在看图，生成标题中…' : item.status === 'pending' ? '等待生成标题' : item.error}</span>}</button>{item.title && item.error && <p className="row-warning">{item.error}</p>}</td><td className="number-cell">{item.char_count ?? '—'}</td><td><span className={cn('status-badge', `status-${item.status}`)}><i/>{statusText[item.status]}</span></td></tr>)}
        </tbody></table>{!data.items.length && <div className="no-results">此筛选下没有商品。</div>}</div>
        <div className="pagination"><span>共 {data.total} 项 · 每页 50 项</span><div><Btn className="icon-btn" aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page-1)}><ChevronLeft size={17}/></Btn><span>{page} / {Math.max(1,Math.ceil(data.total/50))}</span><Btn className="icon-btn" aria-label="下一页" disabled={page*50 >= data.total} onClick={() => setPage(page+1)}><ChevronRight size={17}/></Btn></div></div></>}
    </section></div></main>
    <footer className="task-footer"><div className="footer-progress"><div><span>{batch ? `已处理 ${batch.processed} / ${batch.total}` : '准备就绪'}<span className="footer-secondary">{batch ? `有风险 ${batch.counts.review || 0} · 失败 ${(batch.counts.failed || 0) + (batch.counts.unknown || 0)}` : '每个商品生成 1 条标题'}</span></span><strong>{progress}%</strong></div><progress value={progress} max={100} aria-label="批次完成进度"/></div><div className="footer-actions">
      {batch && <><Btn disabled={!!busy || active} onClick={() => void action('export')}><ArrowDownToLine size={16}/>{busy === 'export' ? '导出中…' : '导出 Excel'}</Btn>{batch.exported_at && <Btn disabled={!!busy} onClick={() => void openOutput()}><FileSpreadsheet size={16}/>打开结果</Btn>}{selected.size > 0 && <Btn disabled={!!busy || active} onClick={() => void action('retry')}><RefreshCw size={15}/>重新生成 {selected.size} 项</Btn>}</>}
      {active ? <Btn primary disabled={batch?.status === 'pausing' || !!busy} onClick={() => void action('pause')}><Pause size={16}/>{batch?.status === 'pausing' ? '等待请求收尾…' : '暂停生成'}</Btn> : <Btn primary disabled={!count || !!busy || (!!batch && !batch.counts.pending)} onClick={() => void start()}><Play size={16}/>{busy === 'start' ? '正在开始…' : batch ? '继续生成' : `开始生成${count ? ` · ${count} 项` : ''}`}</Btn>}
    </div></footer>
    {showSettings && settings && <SettingsModal settings={{ ...settings, defaults: options }} onClose={() => setShowSettings(false)} onSaved={s => { setSettings(s); if (!batch) setOptions(s.defaults); void api<{ models: Model[] }>('/providers/aliyun/models').then(r => setModels(r.models)); }}/ >}
    <Modal open={showOptions} onClose={() => setShowOptions(false)} title="生成设置" description="设定本批商品的语言与标题要求">{optionsPanel}</Modal>
    <Modal open={skill !== null} onClose={() => setSkill(null)} title="内置通用标题规则" description="每次生成自动使用此规则，补充要求与图片一起发送。" wide><pre className="skill-content">{skill}</pre></Modal>
    <Modal open={history !== null} onClose={() => setHistory(null)} title="历史批次" description="已生成的标题和原始结果保存在本机。" wide><div className="history-list">{history?.length ? history.map(b => <button key={b.id} className="history-item" onClick={() => { setBatch(b); setScan(null); setOptions(b.options); setMode(b.mode); setDirectory(b.directory); setPage(1); setFilter('all'); setSelected(new Set()); setHistory(null); }}><FileSpreadsheet size={24}/><div><strong>{b.directory.split(/[\\/]/).pop()}</strong><p>{new Date(b.created_at).toLocaleString('zh-CN')} · {b.total} 个商品 · {b.options.language}</p></div><span className="status-badge">{statusText[b.status]}</span><ChevronRight size={18}/></button>) : <div className="no-results">还没有历史批次，生成后会自动保存在这里。</div>}</div></Modal>
    <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.sku || '商品详情'} description="查看商品图片、最终标题与每次调用的原始结果。" wide>{detail && <div className="detail-layout"><div className="detail-image">{detail.fingerprint ? <img src={imageUrl(detail)} alt={detail.sku}/> : <ImageIcon size={48}/>}</div><div className="detail-content"><span className={cn('status-badge',`status-${detail.status}`)}>{statusText[detail.status]}</span><h3>生成标题</h3><p className="full-title">{detail.title || '尚无可导出的标题'}</p><p className="field-help">{detail.char_count ?? '—'} 字符{detail.elapsed != null && ` · 用时 ${detail.elapsed.toFixed(1)} 秒`}</p>{detail.language_check?.status === 'passed' && <p className="field-help">{detail.language_check.message}</p>}{detail.title && !detail.language_check && <p className="field-help">此历史标题尚未进行语言检查。</p>}{detail.error && <p className="error-message">{detail.error}</p>}<p className="source-path">{detail.image_path}</p>{detail.attempts?.map(a => <details className="attempt" key={a.id}><summary>第 {detail.attempts!.indexOf(a)+1} 次请求 · {statusText[a.status]} · 原始结果</summary><pre>{a.raw || '无正文'}</pre>{a.error && <p className="row-warning">{a.error}</p>}</details>)}{batch?.exported_at && <Btn className="mt-4" onClick={() => void openOutput(true)}><FolderOpen size={15}/>打开输出目录</Btn>}</div></div>}</Modal>
    <div className="sr-only" aria-live="polite">{batch ? `已完成处理 ${batch.processed} 个商品` : ''}</div>
  </div>;
}
