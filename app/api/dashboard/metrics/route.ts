import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { getDashboardMetrics } from '@/lib/server/dashboard-service';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    return successResponse(await getDashboardMetrics());
  } catch (error) {
    return errorResponse(error);
  }
}
