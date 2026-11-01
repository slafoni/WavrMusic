import type { WavrSyncBadge } from '../../../shared/models';
import { Icon } from './Icon';

const BADGE_ORDER: WavrSyncBadge[] = ['developer', 'alpha', 'beta'];

const BADGE_TITLES: Record<WavrSyncBadge, string> = {
  developer: 'WAVR Developer',
  alpha: 'WAVR Alpha Tester',
  beta: 'WAVR Beta Tester',
};

export function normalizeWavrBadges(badges?: readonly string[] | null): WavrSyncBadge[] {
  if (!Array.isArray(badges)) return [];
  const advertised = new Set(badges.map((badge) => String(badge).toLowerCase()));
  return BADGE_ORDER.filter((badge) => advertised.has(badge));
}

export function DeveloperBadge({ badges }: { badges?: readonly string[] | null }) {
  const roles = normalizeWavrBadges(badges);
  if (!roles.length) return null;
  return (
    <>
      {roles.map((role) => {
        const title = BADGE_TITLES[role];
        return (
          <span
            key={role}
            className={`developer-badge verified-badge ${role}`}
            title={title}
            aria-label={title}
          >
            <Icon name="verified" size={16} />
          </span>
        );
      })}
    </>
  );
}
