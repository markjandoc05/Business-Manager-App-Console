import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from './api-errors';
import { mutateLicense } from './license-service';
import { requirePlatformAdmin } from './platform-admin';
import { readJsonBody } from './request';

export async function handleLicenseRequest(request: NextRequest, orgId: string, action: Parameters<typeof mutateLicense>[1]) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    const body = await readJsonBody(request);
    return successResponse(await mutateLicense(orgId, action, body, actor));
  } catch (error) {
    return errorResponse(error);
  }
}
