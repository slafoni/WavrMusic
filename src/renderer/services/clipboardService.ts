function electronApi(): any {
  return (window as any).electronAPI;
}

export async function copyText(value: string): Promise<boolean> {
  const text = String(value || '');
  if (!text) return false;
  try {
    if (typeof electronApi()?.copyText === 'function') {
      await electronApi().copyText(text);
      return true;
    }
  } catch {
    /* fall through to browser clipboard */
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to execCommand */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
