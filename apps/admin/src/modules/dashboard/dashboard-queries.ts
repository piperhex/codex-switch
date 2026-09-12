export const DASHBOARD_QUERIES = {
  SUMMARY: `
    SELECT
      (SELECT COUNT(*) FROM users)::text AS "totalUsers",
      (SELECT COUNT(*) FROM users WHERE disabled = false)::text AS "activeUsers",
      (SELECT COUNT(DISTINCT "deviceId") FROM device_telemetry_events
        WHERE "eventType" = 'activity'
          AND "createdAt" >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      )::text AS "dailyActiveUsers",
      (SELECT COUNT(*) FROM users WHERE "createdAt" >= $1)::text AS "newUsers",
      (SELECT COUNT(*) FROM device_installations)::text AS "totalInstallations",
      (SELECT COUNT(*) FROM device_installations WHERE "firstSeenAt" >= $1)::text AS "newInstallations",
      (SELECT COUNT(*) FROM system_accounts)::text AS "officialAccounts",
      (SELECT COUNT(DISTINCT "systemAccountId") FROM system_account_bindings)::text AS "boundOfficialAccounts",
      (SELECT COUNT(*) FROM system_account_bindings)::text AS "totalBindings",
      (SELECT COUNT(*) FROM user_feedback WHERE "lastRepliedAt" IS NULL)::text AS "pendingFeedback",
      (SELECT COUNT(*) FROM user_feedback WHERE "lastRepliedAt" IS NOT NULL)::text AS "repliedFeedback",
      (SELECT COUNT(*) FROM admin_approval_requests WHERE status = 'pending')::text AS "pendingApprovals"
  `,
  USERS: `
    SELECT TO_CHAR(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
           COUNT(*)::text AS count
    FROM users
    WHERE "createdAt" >= $1
    GROUP BY 1
    ORDER BY 1
  `,
  INSTALLATIONS: `
    SELECT TO_CHAR(("firstSeenAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
           platform, COUNT(*)::text AS count
    FROM device_installations
    WHERE "firstSeenAt" >= $1
    GROUP BY 1, platform
    ORDER BY 1, platform
  `,
  PLATFORMS: `
    SELECT platform AS name, COUNT(*)::text AS count
    FROM device_installations
    GROUP BY platform
    ORDER BY COUNT(*) DESC
  `,
  PLANS: `
    SELECT COALESCE(NULLIF(TRIM(plan), ''), 'Unknown') AS name,
           COUNT(*)::text AS count
    FROM system_accounts
    GROUP BY 1
    ORDER BY COUNT(*) DESC, name ASC
    LIMIT 8
  `,
  DAILY_ACTIVE: `
    SELECT platform AS name, COUNT(DISTINCT "deviceId")::text AS count
    FROM device_telemetry_events
    WHERE "eventType" = 'activity'
      AND "createdAt" >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    GROUP BY platform
  `,
};
