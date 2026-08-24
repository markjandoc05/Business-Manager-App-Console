import { NextRequest } from 'next/server';
import './firebase-admin';
import { errorResponse, successResponse } from './api-error-response';
import { handleLicenseMutation } from './license-handler';
import { readJsonBody } from './request';

export async function handleLicenseRequest(request: NextRequest, orgId: string, action: Parameters<typeof handleLicenseMutation>[2]) {
  try {
    const header = request.headers.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return successResponse(await handleLicenseMutation(token, orgId, action, () => readJsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
