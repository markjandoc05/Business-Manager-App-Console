export type OrganizationLocaleSettings = {
  timezone: string | null;
  currency: string | null;
  timezoneSource: string;
  currencySource: string;
};

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveField(
  field: 'timezone' | 'currency',
  organizationData: Record<string, unknown>,
  settingsData: Record<string, unknown>,
  organizationPath: string,
  settingsPath: string,
) {
  const canonicalValue = nonEmptyString(settingsData[field]);
  if (canonicalValue) return { value: canonicalValue, source: `${settingsPath}.${field}` };
  const compatibilityValue = nonEmptyString(organizationData[field]);
  if (compatibilityValue) return { value: compatibilityValue, source: `${organizationPath}.${field}` };
  return { value: null, source: 'none' };
}

export function resolveOrganizationLocaleSettingsFromData(
  organizationData: Record<string, unknown>,
  settingsData: Record<string, unknown>,
  organizationId = 'organization',
): OrganizationLocaleSettings {
  const organizationPath = `organizations/${organizationId}`;
  const settingsPath = `${organizationPath}/settings/settings`;
  const timezone = resolveField('timezone', organizationData, settingsData, organizationPath, settingsPath);
  const currency = resolveField('currency', organizationData, settingsData, organizationPath, settingsPath);
  return { timezone: timezone.value, currency: currency.value, timezoneSource: timezone.source, currencySource: currency.source };
}

export async function resolveOrganizationLocaleSettings(orgId: string): Promise<OrganizationLocaleSettings> {
  const { adminDb } = await import('./firebase-admin-core.ts');
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const [organizationSnapshot, settingsSnapshot] = await Promise.all([
    organizationRef.get(),
    organizationRef.collection('settings').doc('settings').get(),
  ]);
  return resolveOrganizationLocaleSettingsFromData(
    organizationSnapshot.exists ? organizationSnapshot.data() || {} : {},
    settingsSnapshot.exists ? settingsSnapshot.data() || {} : {},
    orgId,
  );
}
