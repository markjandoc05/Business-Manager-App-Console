import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { resetOrganizationForRegistration } from '@/lib/server/organization-registration-reset-service';
import { readJsonBody } from '@/lib/server/request';

/** Explicit command route: normal organization profile updates never delete data. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    return successResponse(await resetOrganizationForRegistration((await params).orgId, await readJsonBody(request), actor));
  } catch (error) { return errorResponse(error); }
}
