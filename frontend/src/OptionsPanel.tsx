import { Switch } from '@base-ui/react/switch';
import { useId } from 'react';
import { BookOpen, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import type { Model, Options } from './api';
import { Btn, Choice, TextInput } from './ui';

export default function OptionsPanel({ value, onChange, models, locked, refreshing, onRefresh, onSkill }: {
  value: Options; onChange(v: Options): void; models: Model[]; locked: boolean; refreshing: boolean;
  onRefresh(): void; onSkill(): void;
}) {
  const fieldId = useId();
  const change = <K extends keyof Options>(key: K, v: Options[K]) => onChange({ ...value, [key]: v });
  const current = models.find(m => m.id === value.model);
  const modelOptions = models.map(m => ({ value: m.id, label: m.id }));
  if (!modelOptions.some(m => m.value === value.model)) modelOptions.unshift({ value: value.model, label: value.model });
  return <div className="options-panel">
    <div className="section-heading"><Settings2 size={17}/><h2>生成设置</h2><span>本批统一使用</span></div>
    {locked && <p className="small-note">本批设置已固定。开始新批次可修改要求。</p>}
    <div className="field"><label>模型服务商</label><Choice label="模型服务商" value="aliyun" onChange={() => {}} options={[{ value: 'aliyun', label: '阿里云 · 千问' }]} disabled={locked}/></div>
    <div className="field"><div className="field-label"><label>生成模型</label><Btn className="text-btn" onClick={onRefresh} disabled={refreshing || locked} aria-label="刷新模型"><RefreshCw size={13}/>{refreshing ? '获取中' : '刷新'}</Btn></div>
      <Choice label="生成模型" value={value.model} options={modelOptions} disabled={locked} onChange={id => { const m = models.find(m => m.id === id); onChange({ ...value, model: id, thinking: m?.thinking === 'on' ? true : m?.thinking === 'unknown' ? null : false }); }}/>
      <p className="field-help">支持看图写标题的模型。输入字母可定位型号。</p>
    </div>
    <div className="thinking-row"><div><span className="label-with-icon"><Sparkles size={15}/>深度思考</span><p className="field-help">{current?.thinking === 'unknown' ? '能力未知，跟随模型默认' : current?.thinking === 'on' ? '此模型固定开启' : current?.thinking === 'off' ? '此模型不支持思考' : '开启后可能增加时间和费用'}</p></div>
      <Switch.Root className="switch" checked={value.thinking === true} onCheckedChange={v => change('thinking', v)} disabled={locked || current?.thinking !== 'switchable'} aria-label="深度思考"><Switch.Thumb className="switch-thumb"/></Switch.Root>
    </div>
    <div className="panel-divider"/>
    <div className="field"><label htmlFor={`${fieldId}-language`}>目标语言</label><TextInput id={`${fieldId}-language`} list={`${fieldId}-languages`} value={value.language} onChange={e => change('language', e.target.value)} disabled={locked}/><datalist id={`${fieldId}-languages`}>{['英语','西班牙语','德语','法语','意大利语','葡萄牙语','日语','韩语','泰语','越南语','中文'].map(l => <option key={l} value={l}/>)}</datalist></div>
    <div className="field"><label>字符范围 <span className="optional">选填</span></label><div className="range-inputs"><TextInput aria-label="最少字符" type="number" min={1} max={32767} placeholder="最少" value={value.min_chars ?? ''} onChange={e => change('min_chars', e.target.value ? Number(e.target.value) : null)} disabled={locked}/><span>—</span><TextInput aria-label="最多字符" type="number" min={1} max={32767} placeholder="最多" value={value.max_chars ?? ''} onChange={e => change('max_chars', e.target.value ? Number(e.target.value) : null)} disabled={locked}/></div><p className="field-help">按可见字符统计，包含空格与标点。</p></div>
    <div className="field"><label htmlFor={`${fieldId}-requirements`}>补充要求 <span className="optional">选填</span></label><textarea id={`${fieldId}-requirements`} className="input requirements" placeholder="例如：面向美国市场，突出商品图案，避免促销词。也可填写已确认的商品资料。" value={value.requirements} onChange={e => change('requirements', e.target.value)} disabled={locked}/></div>
    <Btn className="skill-link" onClick={onSkill}><BookOpen size={15}/><span>查看内置标题规则</span><span className="skill-tag">SKILL</span></Btn>
    <p className="panel-footnote">生成后检查语言与字符数。未通过或语言待确认时标记“有风险”，保留标题，由你选择重新生成。</p>
  </div>;
}
