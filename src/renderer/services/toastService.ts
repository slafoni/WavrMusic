export type ToastKind = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (toasts: ToastMessage[]) => void;

let nextId = 1;
let toasts: ToastMessage[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function pushToast(message: string, kind: ToastKind = 'info') {
  const toast: ToastMessage = { id: nextId++, message, kind };
  toasts = [...toasts, toast].slice(-4);
  emit();
  window.setTimeout(() => dismissToast(toast.id), 4500);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}
