import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { dismissToast, subscribeToasts, type ToastMessage } from '../services/toastService';

export function Toaster() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (!toasts.length) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span className="toast-icon">
            <Icon
              name={toast.kind === 'error' ? 'error' : toast.kind === 'success' ? 'check_circle' : 'info'}
              size={18}
            />
          </span>
          <span className="toast-text">{toast.message}</span>
          <button
            className="btn-icon btn-compact"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
            style={{ marginLeft: 'auto', width: 26, height: 26 }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
