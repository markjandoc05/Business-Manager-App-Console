import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { getPlatformHealth } from '@/lib/server/platform-health-service';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';

export const dynamic = 'force-dynamic';

/** Read-only Platform Health. SUPER_ADMIN and SUPPORT may view it. */
export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    return successResponse(await getPlatformHealth());
  } catch (error) {
    return errorResponse(error);
  }
}
