import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { ArrowDownToLine, ArrowRight, ChevronLeft, ChevronRight, FileSpreadsheet, FolderOpen, History, Image as ImageIcon, ListFilter, Pause, Play, Plus, RefreshCw, Settings as SettingsIcon, Settings2, Sparkles, X } from 'lucide-react';
import { api, connect, defaults, statusText, batchStatusText, unknownResultHelp, type Batch, type Item, type Model, type Options, type Page, type Scan, type Settings } from './api';
import { Btn, cn, Modal, TextInput, Tick } from './ui';
import OptionsPanel from './OptionsPanel';
import SettingsModal from './SettingsModal';

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [connectionState, setConnectionState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [options, setOptions] = useState<Options>(defaults);
  const [models, setModels] = useState<Model[]>([]);
  const [mode, setMode] = useState('sku');
  const [directory, setDirectory] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [data, setData] = useState<Page>({ items: [], total: 0, page: 1, counts: {} });
  const [listState, setListState] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; error?: string }>({ key: '', status: 'loading' });
  const [reloadItems, setReloadItems] = useState(0);
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
  const pageKey = scope ? `${scope.kind}/${scope.id}/${filter}/${page}` : '';
  const listLoading = listState.key !== pageKey || listState.status === 'loading';
  const listError = listState.key === pageKey && listState.status === 'error' ? listState.error : '';
  const visibleItems = listState.key === pageKey && listState.status === 'ready' ? data.items : [];
  const connectionText = connectionState === 'loading' ? '正在连接…' : connectionState === 'error' ? '连接失败' : settings?.key_configured ? 'API 密钥已配置' : 'API 密钥未配置';
  const preparationText = connectionState !== 'ready' ? connectionText : !directory.trim() ? '请选择商品文件夹' : !scope ? '请扫描商品' : !count ? '未找到商品，请检查文件夹' : listLoading ? '正在加载商品…' : listError ? '商品加载失败' : !settings?.key_configured ? '请配置 API 密钥' : !data.counts.pending ? '请修复商品图片后重新扫描' : '可以开始生成';
  const batchSummary = batch ? `已生成 ${batch.counts.completed || 0} · 需检查 ${batch.counts.review || 0} · 生成失败 ${batch.counts.failed || 0} · 结果未知 ${batch.counts.unknown || 0}` : '';

  useEffect(() => {
    let disposed = false;
    connect().then(async s => {
      const m = await api<{ models: Model[] }>('/providers/aliyun/models');
      if (!disposed) { setSettings(s); setOptions(s.defaults); setModels(m.models); setConnectionState('ready'); }
    }).catch(e => { if (!disposed) { setError(e.message); setConnectionState('error'); } });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!scope) { setData({ items: [], total: 0, page: 1, counts: {} }); return; }
    let disposed = false, loading = false;
    const current = scope;
    const requestKey = pageKey;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      setListState(old => old.key === requestKey && old.status === 'ready' ? old : { key: requestKey, status: 'loading' });
      try {
        const result = await api<Page>(`/${current.kind === 'batch' ? 'batches' : 'scans'}/${current.id}/items?status=${filter}&page=${page}`);
        const summary = current.kind === 'batch' ? await api<Batch>(`/batches/${current.id}`) : null;
        if (!disposed) { setData(result); setListState({ key: requestKey, status: 'ready' }); if (summary) setBatch(summary); }
      } catch (e) { if (!disposed) setListState({ key: requestKey, status: 'error', error: (e as Error).message }); }
      finally { loading = false; }
    };
    void refresh();
    const timer = active ? setInterval(() => void refresh(), 1000) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [pageKey, active, busy, reloadItems]);

  async function perform(name: string, work: () => Promise<void>) {
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  async function chooseDirectory() {
    if (window.pywebview) {
      await perform('directory', async () => { const path = await window.pywebview!.api.choose_directory(); if (path) { resetResults(); setDirectory(path); } });
    } else { pathInput.current?.focus(); setNotice('请在“文件夹路径”中粘贴本机商品文件夹的完整路径。'); }
  }

  function resetResults() { if (batch && settings) setOptions(settings.defaults); setScan(null); setBatch(null); setSelected(new Set()); setPage(1); setFilter('all'); }
  async function doScan() {
    await perform('scan', async () => {
      const result = await api<Scan>('/scans', 'POST', { directory, mode });
      resetResults(); setScan(result); setDirectory(result.directory);
      if (!result.total) setNotice(mode === 'sku' ? '未找到货号文件夹。请选择包含各货号子文件夹的商品文件夹。' : '未找到支持的商品图片。请选择直接存放图片的文件夹。');
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
      if (name === 'export' && !result.export_error) setNotice(`Excel 已保存至商品文件夹：${result.excel_path.split(/[\\/]/).pop()}`);
    });
  }

  async function openOutput(folder = false) {
    if (!batch) return;
    await perform('open', async () => {
      if (window.pywebview) { const result = await window.pywebview.api.open_output(batch.id, folder); if (result.error) throw new Error(result.error); }
      else if (folder) setNotice(`保存文件夹：${batch.directory}`);
      else { const anchor = document.createElement('a'); anchor.href = `/api/batches/${batch.id}/excel`; anchor.click(); }
    });
  }

  const imageUrl = (item: Item) => scope ? `/api/images/${scope.kind}/${scope.id}/${item.id}` : '';
  const eligible = (item: Item) => !item.input_error && !['running', 'pending'].includes(item.status);
  const selectable = batch ? visibleItems.filter(eligible) : [];
  const selectItem = (id: string, checked: boolean) => setSelected(old => { const next = new Set(old); checked ? next.add(id) : next.delete(id); return next; });
  const optionsPanel = <OptionsPanel value={options} onChange={setOptions} models={models} locked={!!batch || !!busy || connectionState !== 'ready'} batchLocked={!!batch} refreshing={busy === 'models'}
    onRefresh={() => void perform('models', async () => { const result = await api<{ models: Model[] }>('/providers/aliyun/models/refresh', 'POST'); setModels(result.models); setNotice(`已更新模型列表，共 ${result.models.length} 个支持看图写标题的模型。是否可调用取决于账号权限。`); })}
    onSkill={() => void perform('skill', async () => setSkill((await api<{ text: string }>('/skill')).text))}/>;

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark"><img src="/app-icon.png" alt=""/></div><div><h1>腾域 <span>ai 写标题</span></h1><p>跨境电商 · 批量标题工作台</p></div></div>
      <div className="header-actions"><span className={cn('connection', connectionState === 'ready' && settings?.key_configured && 'configured')}><span/>{connectionText}</span><Btn disabled={active || !!busy || connectionState !== 'ready'} onClick={() => void perform('history', async () => setHistory(await api<Batch[]>('/batches')))}><History size={16}/>历史批次</Btn><Btn disabled={active || !settings} onClick={() => setShowSettings(true)}><SettingsIcon size={16}/>设置</Btn></div>
    </header>
    <main className={cn('workspace', scope && 'has-results')}><section className="directory-card">
      <div className="directory-heading"><h2>批量生成商品标题</h2><span className="output-pill"><FileSpreadsheet size={15}/>货号 + 标题 · Excel</span></div>
      <div className="directory-controls"><Tabs.Root value={mode} onValueChange={v => { if (!active) { setMode(String(v)); resetResults(); } }} className="mode-tabs"><Tabs.List className="segment-list" aria-label="商品识别方式"><Tabs.Tab value="sku" disabled={active} className="segment"><FolderOpen size={16}/>按货号文件夹</Tabs.Tab><Tabs.Tab value="images" disabled={active} className="segment"><ImageIcon size={16}/>按图片</Tabs.Tab></Tabs.List></Tabs.Root>
        <div className="path-input"><FolderOpen size={17}/><TextInput ref={pathInput} aria-label="文件夹路径" placeholder={mode === 'sku' ? '选择包含各货号子文件夹的商品文件夹' : '选择直接存放商品图片的文件夹'} value={directory} title={directory} disabled={active || !!busy} onChange={e => { setDirectory(e.target.value); resetResults(); }}/></div>
        <Btn disabled={active || !!busy} onClick={() => void chooseDirectory()}>选择文件夹</Btn><Btn className="scan-btn" disabled={!directory.trim() || active || !!busy || !settings} onClick={() => void doScan()}>{busy === 'scan' ? '扫描中…' : '扫描商品'}<ArrowRight size={15}/></Btn>
      </div>
      <div className="directory-caption"><span>{mode === 'sku' ? '每个子文件夹对应一个货号，只取其中按文件名自然排序的第一张图片（2 排在 10 前）' : '每张图片对应一个商品，文件名去掉扩展名作为货号'}</span>{scope && <span className="output-path" title={directory}>共 {count} 个商品 · Excel 保存到此文件夹</span>}</div>
    </section>
    <div className="mobile-options"><Btn onClick={() => setShowOptions(true)}><Settings2 size={16}/>生成设置</Btn><span>{options.language} · {options.model}</span></div>
    {(error || notice || batch?.error || batch?.export_error) && <div className={cn('message-bar', (error || batch?.export_error || batch?.error) && 'message-error')} role={error || batch?.export_error || batch?.error ? 'alert' : 'status'}><span>{error || batch?.export_error || batch?.error || notice}</span>{(error || notice) && <button className="icon-btn" aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><X size={16}/></button>}</div>}
    <div className="work-grid"><aside className="desktop-options">{optionsPanel}</aside><section className="results-panel">
      <div className="results-heading"><div><h2>商品与标题 <span className="count-badge">{count}</span></h2><p>{batch ? `批次 ${batch.id.slice(0, 6)} · ${batchStatusText[batch.status] || '状态未知'}` : scope ? '确认商品图片和生成设置后，点击“开始生成”' : '扫描后在这里确认商品图片'}</p>{batch && <p>{batchSummary}</p>}</div>{scope && <Btn className="text-btn" disabled={active || !!busy} onClick={() => { const hadBatch = !!batch; resetResults(); setNotice(hadBatch ? '已返回新批次，原批次可在“历史批次”中查看。' : '已清空扫描结果，请重新扫描商品。'); }}><Plus size={15}/>新批次</Btn>}</div>
      <div className="filter-bar"><ListFilter size={15}/>{[['all','全部'],['pending','待生成'],['completed','已生成'],['review','需检查'],['failed','生成失败'],['unknown','结果未知']].map(([id,label]) => <button key={id} className={cn('filter-btn', filter === id && 'is-active')} onClick={() => { setFilter(id); setPage(1); }} aria-pressed={filter === id}>{label}{id !== 'all' && scope && listState.key === pageKey && data.counts[id] ? <span>{data.counts[id]}</span> : null}</button>)}<span className="filter-hint">点击图片或标题查看详情</span></div>
      {!scope ? <div className="empty-state"><div className="empty-art"><div className="art-sheet"><span/><span/><span/><FileSpreadsheet size={31}/></div><div className="art-folder"><FolderOpen size={56} strokeWidth={1.3}/></div><div className="art-spark"><Sparkles size={19}/></div></div><h3>选择商品文件夹</h3><p>扫描后确认商品图片，再开始生成标题。<br/>处理结束后自动保存 Excel。</p><Btn primary onClick={() => void chooseDirectory()}><FolderOpen size={17}/>选择商品文件夹</Btn><div className="empty-steps"><span>01 选择文件夹</span><ArrowRight size={13}/><span>02 扫描商品</span><ArrowRight size={13}/><span>03 生成标题</span><ArrowRight size={13}/><span>04 查看 Excel</span></div></div>
        : <><div className="table-scroll" aria-busy={listLoading}><table className="result-table"><thead><tr><th className="check-col"><Tick label="选择本页可重新生成的商品" checked={selectable.length > 0 && selectable.every(i => selected.has(i.id))} disabled={active || !selectable.length} onChange={v => setSelected(old => { const next = new Set(old); selectable.forEach(i => v ? next.add(i.id) : next.delete(i.id)); return next; })}/></th><th className="image-col">图片</th><th className="sku-col">货号</th><th>商品标题</th><th className="chars-col">字符数</th><th className="status-col">状态</th></tr></thead><tbody>
          {visibleItems.map(item => <tr key={item.id} className={cn(selected.has(item.id) && 'selected-row')}><td><Tick label={`选择 ${item.sku}`} checked={selected.has(item.id)} disabled={active || !batch || !eligible(item)} onChange={v => selectItem(item.id,v)}/></td><td><button className="thumbnail" aria-label={`预览 ${item.sku}`} onClick={() => void perform('detail', async () => setDetail(batch ? await api<Item>(`/batches/${batch.id}/items/${item.id}`) : item))}>{item.fingerprint ? <img src={imageUrl(item)} alt={item.sku} loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/>: <ImageIcon size={21}/>}</button></td><td><strong className="sku-text" title={item.sku}>{item.sku}</strong>{item.warnings.length > 0 && <span className="duplicate-label" title={item.warnings.join('；')}>货号重复</span>}</td><td><button className="title-cell" onClick={() => void perform('detail', async () => setDetail(batch ? await api<Item>(`/batches/${batch.id}/items/${item.id}`) : item))}>{item.title ? <span className="line-clamp-2">{item.title}</span> : <span className="title-placeholder">{item.status === 'running' ? '正在生成标题…' : item.status === 'pending' ? '等待生成标题' : item.error || statusText[item.status]}</span>}</button>{item.title && item.error && <p className="row-warning">{item.error}</p>}</td><td className="number-cell">{item.char_count ?? '—'}</td><td><span className={cn('status-badge', `status-${item.status}`)}><i/>{statusText[item.status] || '状态未知'}</span></td></tr>)}
        </tbody></table>{listLoading ? <div className="no-results" role="status">正在加载商品…</div> : listError ? <div className="no-results" role="alert"><p>商品加载失败</p><p className="field-help">{listError}</p><Btn onClick={() => setReloadItems(v => v + 1)}>重新加载</Btn></div> : !visibleItems.length && <div className="no-results">{count ? '没有符合当前筛选条件的商品。' : '未找到商品，请检查商品文件夹和识别方式。'}</div>}</div>
        <div className="pagination"><span>{listLoading || listError ? '每页 50 个商品' : `共 ${data.total} 个商品 · 每页 50 个`}</span><div><Btn className="icon-btn" aria-label="上一页" disabled={listLoading || !!listError || page <= 1} onClick={() => setPage(page-1)}><ChevronLeft size={17}/></Btn><span>{listLoading || listError ? '—' : `${page} / ${Math.max(1,Math.ceil(data.total/50))}`}</span><Btn className="icon-btn" aria-label="下一页" disabled={listLoading || !!listError || page*50 >= data.total} onClick={() => setPage(page+1)}><ChevronRight size={17}/></Btn></div></div></>}
    </section></div></main>
    <footer className="task-footer"><div className="footer-progress"><div><span>{batch ? `已处理 ${batch.processed} / ${batch.total}` : preparationText}{!batch && <span className="footer-secondary">每个商品生成 1 条标题</span>}</span><strong>{progress}%</strong></div><progress value={progress} max={100} aria-label="批次处理进度"/></div><div className="footer-actions">
      {batch && <><Btn disabled={!!busy || active} onClick={() => void action('export')}><ArrowDownToLine size={16}/>{busy === 'export' ? '导出中…' : batch.exported_at || batch.export_error ? '重新导出 Excel' : '导出当前结果'}</Btn>{batch.exported_at && <Btn disabled={!!busy} onClick={() => void openOutput()}><FileSpreadsheet size={16}/>{window.pywebview ? '打开 Excel' : '下载 Excel'}</Btn>}{selected.size > 0 && <Btn disabled={!!busy || active || listLoading || !!listError} aria-describedby="regenerate-help" onClick={() => void action('retry')}><RefreshCw size={15}/>重新生成 {selected.size} 个商品</Btn>}</>}
      {active ? <Btn primary disabled={batch?.status === 'pausing' || !!busy} onClick={() => void action('pause')}><Pause size={16}/>{batch?.status === 'pausing' ? '正在暂停…' : '暂停生成'}</Btn> : <Btn primary disabled={!count || !!busy || connectionState !== 'ready' || listLoading || !!listError || (!!batch && !batch.counts.pending)} onClick={() => void start()}><Play size={16}/>{busy === 'start' ? '正在启动…' : batch ? '继续生成' : `开始生成${count ? ` · ${count} 个商品` : ''}`}</Btn>}
    </div>{batch && <div className="footer-notes">
      {batch.status === 'pausing' && <p role="status">正在暂停，等待当前请求结束…</p>}
      {selected.size > 0 && <p id="regenerate-help" className="regenerate-help">将清空所选商品的当前标题并重新生成，可能产生新的费用。历史结果保留。</p>}
      {!!batch.counts.unknown && <p className="unknown-help">{unknownResultHelp}</p>}
      <p>处理结束后自动保存 Excel。未生成的标题留空，需检查的标题会标黄。{batch.exported_at && '重新导出会更新原文件。'}</p>
    </div>}</footer>
    {showSettings && settings && <SettingsModal settings={{ ...settings, defaults: batch ? settings.defaults : options }} onClose={() => setShowSettings(false)} onSaved={s => { setSettings(s); if (!batch) setOptions(s.defaults); void api<{ models: Model[] }>('/providers/aliyun/models').then(r => setModels(r.models)).catch(e => setError(e.message)); }}/ >}
    <Modal open={showOptions} onClose={() => setShowOptions(false)} title="生成设置" description="设定本批商品的语言与标题要求">{optionsPanel}</Modal>
    <Modal open={skill !== null} onClose={() => setSkill(null)} title="标题规则" description="每次生成都会使用这些规则，并结合商品图片和补充要求。" wide><pre className="skill-content">{skill}</pre></Modal>
    <Modal open={history !== null} onClose={() => setHistory(null)} title="历史批次" description="批次、标题和原始结果保存在本机。" wide><div className="history-list">{history?.length ? history.map(b => <button key={b.id} className="history-item" onClick={() => { setBatch(b); setScan(null); setOptions(b.options); setMode(b.mode); setDirectory(b.directory); setPage(1); setFilter('all'); setSelected(new Set()); setHistory(null); setNotice(''); setError(''); }}><FileSpreadsheet size={24}/><div><strong>{b.directory.split(/[\\/]/).pop()}</strong><p>{new Date(b.created_at).toLocaleString('zh-CN')} · {b.total} 个商品 · {b.options.language}</p></div><span className="status-badge">{batchStatusText[b.status] || '状态未知'}</span><ChevronRight size={18}/></button>) : <div className="no-results">还没有历史批次，开始生成后会自动保存在这里。</div>}</div></Modal>
    <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.sku || '商品详情'} description="查看商品图片、当前标题和历次生成结果。" wide>{detail && <div className="detail-layout"><div className="detail-image">{detail.fingerprint ? <img src={imageUrl(detail)} alt={detail.sku}/> : <ImageIcon size={48}/>}</div><div className="detail-content"><span className={cn('status-badge',`status-${detail.status}`)}>{statusText[detail.status] || '状态未知'}</span><h3>当前标题</h3><p className="full-title">{detail.title || '尚未生成标题'}</p><p className="field-help">{detail.char_count ?? '—'} 字符{detail.elapsed != null && ` · 用时 ${detail.elapsed.toFixed(1)} 秒`}</p>{detail.status === 'unknown' && <p className="unknown-help">此次请求可能已计费，重新生成可能产生新的费用。</p>}{detail.error && <p className="error-message">{detail.error}</p>}<p className="source-path">{detail.image_path}</p>{detail.attempts?.map((a, index) => <details className="attempt" key={a.id}><summary>第 {index+1} 次生成 · {statusText[a.status] || '状态未知'} · 原始结果</summary><pre>{a.raw || a.error || '未收到结果正文'}</pre></details>)}{batch?.exported_at && <Btn className="mt-4" onClick={() => void openOutput(true)}><FolderOpen size={15}/>{window.pywebview ? '打开保存文件夹' : '查看保存路径'}</Btn>}</div></div>}</Modal>
    <div className="sr-only" aria-live="polite">{batch ? `已处理 ${batch.processed} 个商品。${batchSummary}` : ''}</div>
  </div>;
}
