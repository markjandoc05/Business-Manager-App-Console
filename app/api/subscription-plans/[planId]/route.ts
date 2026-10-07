import { NextRequest } from 'next/server';
import { handleSubscriptionPlanUpdateRequest } from '@/lib/server/subscription-plan-route';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  return handleSubscriptionPlanUpdateRequest(request, (await params).planId);
}
