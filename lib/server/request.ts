import type { NextRequest } from 'next/server';
import { ApiError } from './api-errors';

export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new ApiError('INVALID_REQUEST', 'Request body must be valid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  return body as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) throw new ApiError('INVALID_REQUEST', `${field} is required.`, 400);
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new ApiError('INVALID_REQUEST', `${field} must be a non-empty string.`, 400);
  return value.trim();
}

export function isoDate(value: unknown, field: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new ApiError('INVALID_REQUEST', `${field} must be a valid ISO date.`, 400);
  return new Date(value);
}

export function integer(value: unknown, field: string, minimum = 0) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) throw new ApiError('INVALID_REQUEST', `${field} must be an integer greater than or equal to ${minimum}.`, 400);
  return value;
}

export function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new ApiError('INVALID_REQUEST', `${field} must be one of: ${allowed.join(', ')}.`, 400);
  return value as T;
}
