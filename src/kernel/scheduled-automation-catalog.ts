import {
  normalizePlatformId,
  SCHEDULED_CONTACT_COMMENT_DAILY_CAP_MAX,
  SCHEDULED_CONTENT_DAILY_CAP_MAX,
  SCHEDULED_GROUP_JOIN_DAILY_CAP_MAX,
} from './platform-types.js';
import type {
  AvailableScheduledAutomationAction,
  PlatformId,
  ScheduledAutomationAction,
  ScheduledAutomationCatalogReader,
  ScheduledAutomationSupport,
} from './platform-types.js';

/**
 * A2 is a closed compile-time catalog shared by api and automation.
 *
 * This is deliberately narrower than PLATFORM_REGISTRY: it contains only the
 * four scheduled actions consumed by ContentScheduleStore and has no IO,
 * projection state, or other platform capabilities.
 */
export const SCHEDULED_AUTOMATION_ACTIONS = [
  'post',
  'comment',
  'contact_comment',
  'join_group',
] as const satisfies readonly ScheduledAutomationAction[];

export const SCHEDULED_AUTOMATION_CATALOG = {
  xiaohongshu: {
    post: {
      supported: true,
      allowedModes: ['review', 'auto_approve'],
      maxDailyCap: SCHEDULED_CONTENT_DAILY_CAP_MAX,
    },
    comment: {
      supported: true,
      allowedModes: ['review', 'auto_approve'],
      maxDailyCap: SCHEDULED_CONTENT_DAILY_CAP_MAX,
    },
    contact_comment: {
      supported: true,
      allowedModes: ['review', 'auto_approve'],
      maxDailyCap: SCHEDULED_CONTACT_COMMENT_DAILY_CAP_MAX,
    },
    join_group: { supported: false, reason: 'no_group_concept' },
  },
  facebook: {
    post: {
      supported: true,
      allowedModes: ['review'],
      maxDailyCap: SCHEDULED_CONTENT_DAILY_CAP_MAX,
    },
    comment: {
      supported: true,
      allowedModes: ['review', 'auto_approve'],
      maxDailyCap: SCHEDULED_CONTENT_DAILY_CAP_MAX,
    },
    contact_comment: {
      supported: true,
      allowedModes: ['review', 'auto_approve'],
      maxDailyCap: SCHEDULED_CONTACT_COMMENT_DAILY_CAP_MAX,
    },
    join_group: {
      supported: true,
      allowedModes: [],
      maxDailyCap: SCHEDULED_GROUP_JOIN_DAILY_CAP_MAX,
    },
  },
  wechat_channels: {
    post: { supported: false, reason: 'interaction_inbox_only' },
    comment: { supported: false, reason: 'interaction_inbox_only' },
    contact_comment: { supported: false, reason: 'interaction_inbox_only' },
    join_group: { supported: false, reason: 'interaction_inbox_only' },
  },
} as const satisfies Record<
  PlatformId,
  Record<ScheduledAutomationAction, ScheduledAutomationSupport>
>;

/** Known aliases normalize; unknown values remain diagnosable and fail closed downstream. */
export function normalizePlatformForCatalog(raw: string | null | undefined): string {
  try {
    return normalizePlatformId(raw);
  } catch {
    return raw?.trim().toLowerCase() || 'unknown';
  }
}

function catalogFor(
  platform: string | null | undefined,
): (typeof SCHEDULED_AUTOMATION_CATALOG)[PlatformId] | null {
  let normalized: PlatformId;
  try {
    normalized = normalizePlatformId(platform);
  } catch {
    return null;
  }
  return SCHEDULED_AUTOMATION_CATALOG[normalized];
}

function cloneSupport(support: ScheduledAutomationSupport): ScheduledAutomationSupport {
  return support.supported
    ? {
        supported: true,
        allowedModes: [...support.allowedModes],
        maxDailyCap: support.maxDailyCap,
      }
    : { supported: false, reason: support.reason };
}

/** Unknown platforms are known-unsupported and therefore return no actions. */
export function availableScheduledAutomationActionsForPlatform(
  platform: string | null | undefined,
): AvailableScheduledAutomationAction[] {
  const catalog = catalogFor(platform);
  if (!catalog) return [];

  return SCHEDULED_AUTOMATION_ACTIONS.flatMap((action) => {
    const support: ScheduledAutomationSupport = catalog[action];
    return support.supported
      ? [{
          action,
          allowedModes: [...support.allowedModes],
          maxDailyCap: support.maxDailyCap,
        }]
      : [];
  });
}

/** Returns a detached declaration table so callers cannot mutate the shared catalog. */
export function scheduledAutomationDeclarationsForPlatform(
  platform: string | null | undefined,
): Record<ScheduledAutomationAction, ScheduledAutomationSupport> | null {
  const catalog = catalogFor(platform);
  if (!catalog) return null;

  return Object.fromEntries(
    SCHEDULED_AUTOMATION_ACTIONS.map((action) => [
      action,
      cloneSupport(catalog[action]),
    ]),
  ) as Record<ScheduledAutomationAction, ScheduledAutomationSupport>;
}

export const SCHEDULED_AUTOMATION_CATALOG_READER: ScheduledAutomationCatalogReader = {
  normalizeForCatalog: normalizePlatformForCatalog,
  availableActions: availableScheduledAutomationActionsForPlatform,
  declarationsFor: scheduledAutomationDeclarationsForPlatform,
};
