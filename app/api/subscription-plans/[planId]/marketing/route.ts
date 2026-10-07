import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { clearSubscriptionPlanMarketing, updateSubscriptionPlanMarketing } from '@/lib/server/subscription-plan-service';
import { readJsonBody } from '@/lib/server/request';

/** Trusted Console-only marketing editor; public plan reads use /api/v1/plans. */
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    return successResponse(await updateSubscriptionPlanMarketing((await params).planId, await readJsonBody(request), actor));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    return successResponse(await clearSubscriptionPlanMarketing((await params).planId, await readJsonBody(request), actor));
  } catch (error) { return errorResponse(error); }
}
