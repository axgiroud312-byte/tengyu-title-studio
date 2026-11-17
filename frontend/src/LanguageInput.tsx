import { Autocomplete } from '@base-ui/react/autocomplete';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

const languages = [
  '英语', '英语（美国）', '英语（英国）', '西班牙语', '葡萄牙语', '葡萄牙语（巴西）',
  '法语', '德语', '意大利语', '荷兰语', '俄语', '波兰语', '乌克兰语',
  '瑞典语', '挪威语', '丹麦语', '芬兰语', '冰岛语', '捷克语', '斯洛伐克语',
  '匈牙利语', '罗马尼亚语', '保加利亚语', '希腊语', '塞尔维亚语', '克罗地亚语',
  '斯洛文尼亚语', '立陶宛语', '拉脱维亚语', '爱沙尼亚语', '阿尔巴尼亚语',
  '土耳其语', '阿拉伯语', '希伯来语', '波斯语', '乌尔都语',
  '印地语', '孟加拉语', '旁遮普语', '泰米尔语', '泰卢固语', '马拉地语',
  '古吉拉特语', '卡纳达语', '马拉雅拉姆语', '尼泊尔语', '僧伽罗语',
  '日语', '韩语', '中文', '简体中文', '繁体中文', '泰语', '越南语',
  '印度尼西亚语', '马来语', '菲律宾语', '缅甸语', '高棉语', '老挝语',
  '蒙古语', '哈萨克语', '乌兹别克语', '斯瓦希里语', '南非荷兰语', '阿姆哈拉语',
];

export default function LanguageInput({ id, value, onChange, disabled }: {
  id: string; value: string; onChange(value: string): void; disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const filtered = languages.filter(language => language.includes(query.trim()));
  return <Autocomplete.Root items={languages} filteredItems={filtered} value={value} disabled={disabled} openOnInputClick
    onValueChange={(next, details) => { onChange(next); setQuery(details.reason === 'input-change' ? next : ''); }}
    onOpenChange={open => { if (!open) setQuery(''); }}>
    <Autocomplete.InputGroup className="language-input">
      <Autocomplete.Input id={id} className="input" maxLength={80} placeholder="选择或输入语言" aria-describedby={`${id}-help`}/>
      <Autocomplete.Trigger className="language-trigger" aria-label="展开语言列表"><ChevronDown size={16}/></Autocomplete.Trigger>
    </Autocomplete.InputGroup>
    <Autocomplete.Portal><Autocomplete.Positioner className="select-position" sideOffset={6}>
      <Autocomplete.Popup className="select-popup language-popup">
        <Autocomplete.Empty className="field-help language-empty">没有匹配项，将使用你输入的语言。</Autocomplete.Empty>
        <Autocomplete.List>{(language: string) => <Autocomplete.Item key={language} value={language} className="select-item">{language}</Autocomplete.Item>}</Autocomplete.List>
      </Autocomplete.Popup>
    </Autocomplete.Positioner></Autocomplete.Portal>
  </Autocomplete.Root>;
}
