import { useId } from 'react';
import { TextInput } from './ui';

export default function SeparatorInput({ label, value, onChange, disabled }: {
  label: string; value: string; onChange(value: string): void; disabled: boolean;
}) {
  const id = useId();
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <TextInput id={id} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      placeholder="输入文字、符号或空格，也可留空" aria-describedby={`${id}-help`}/>
    <p id={`${id}-help`} className="field-help">按输入内容原样拼接，空格保留；留空直接连接。</p>
  </div>;
}
