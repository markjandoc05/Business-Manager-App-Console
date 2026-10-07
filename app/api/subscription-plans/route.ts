import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { bootstrapDefaultSubscriptionPlans, listSubscriptionPlans } from '@/lib/server/subscription-plan-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { await requirePlatformAdmin(request); return successResponse(await listSubscriptionPlans()); } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']); return successResponse(await bootstrapDefaultSubscriptionPlans(actor)); } catch (error) { return errorResponse(error); }
}
