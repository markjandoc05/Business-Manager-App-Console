import { mutateLicense } from './license-service';
import { requirePlatformAdminToken } from './platform-admin';

type LicenseBody = Record<string, unknown> | (() => Promise<Record<string, unknown>>);

export async function handleLicenseMutation(
  idToken: string,
  orgId: string,
  action: Parameters<typeof mutateLicense>[1],
  body: LicenseBody,
) {
  const actor = await requirePlatformAdminToken(idToken, ['SUPER_ADMIN']);
  return mutateLicense(orgId, action, typeof body === 'function' ? await body() : body, actor);
}
