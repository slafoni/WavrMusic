export const APP_BREAKING_SETTING_WARNING =
  '⚠️ DO NOT CHANGE THIS UNLESS YOU KNOW WHAT YOU ARE DOING!';

export function DangerNotice({
  text = APP_BREAKING_SETTING_WARNING,
}: {
  text?: string;
}) {
  return (
    <div className="danger-notice" role="alert">
      {text}
    </div>
  );
}
