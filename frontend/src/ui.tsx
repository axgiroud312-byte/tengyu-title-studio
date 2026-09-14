import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { Select } from '@base-ui/react/select';
import { Input } from '@base-ui/react/input';
import { Checkbox } from '@base-ui/react/checkbox';
import { Check, ChevronDown, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export function Btn({ className, primary, ...props }: ComponentProps<typeof Button> & { primary?: boolean }) {
  return <Button {...props} className={cn('btn', primary && 'btn-primary', className)} />;
}
export function TextInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input {...props} className={cn('input', className)} />;
}
export function Choice({ value, onChange, options, label, disabled }: { value: string; onChange(v: string): void; options: { value: string; label: string }[]; label: string; disabled?: boolean }) {
  return <Select.Root value={value} onValueChange={v => v !== null && onChange(v)} disabled={disabled} items={options}>
    <Select.Trigger className="select-trigger" aria-label={label}><Select.Value/><Select.Icon><ChevronDown size={16}/></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Positioner className="select-position" sideOffset={6}><Select.Popup className="select-popup"><Select.List>
      {options.map(o => <Select.Item key={o.value} value={o.value} className="select-item"><Select.ItemText>{o.label}</Select.ItemText><Select.ItemIndicator><Check size={15}/></Select.ItemIndicator></Select.Item>)}
    </Select.List></Select.Popup></Select.Positioner></Select.Portal>
  </Select.Root>;
}
export function Tick({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return <Checkbox.Root className="checkbox" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled}><Checkbox.Indicator><Check size={13}/></Checkbox.Indicator></Checkbox.Root>;
}
export function Modal({ open, onClose, title, description, children, wide }: { open: boolean; onClose(): void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={v => !v && onClose()}><Dialog.Portal><Dialog.Backdrop className="modal-backdrop"/>
    <Dialog.Popup className={cn('modal', wide && 'modal-wide')}>
      <div className="modal-header"><div><Dialog.Title className="modal-title">{title}</Dialog.Title><Dialog.Description className="modal-description">{description || '查看和管理此项内容'}</Dialog.Description></div><Dialog.Close className="icon-btn" aria-label="关闭弹窗"><X size={20}/></Dialog.Close></div>
      <div className="modal-body">{children}</div>
    </Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
