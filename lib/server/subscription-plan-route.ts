import { NextRequest } from 'next/server';
import './firebase-admin';
import { errorResponse, successResponse } from './api-error-response';
import { bearerToken } from './client-organization-auth';
import { handleSubscriptionPlanUpdate } from './subscription-plan-handler';
import { readJsonBody } from './request';

export async function handleSubscriptionPlanUpdateRequest(request: NextRequest, planId: string) {
  try {
    return successResponse(await handleSubscriptionPlanUpdate(bearerToken(request), planId, await readJsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
