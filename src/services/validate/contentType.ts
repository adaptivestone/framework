import type { StandardSchemaV1 } from './types.ts';

/**
 * A route `request` can be a single Standard Schema (validates any body) or a
 * **content-type map** — `{ 'application/json': schemaA, 'multipart/form-data':
 * schemaB }` — which validates with the schema matching the request's
 * `Content-Type`. The map shape mirrors OpenAPI's `requestBody.content`.
 */
export type RequestContentTypeMap = Record<string, StandardSchemaV1>;

/**
 * Distinguish a content-type map from a Standard Schema. A schema carries
 * `~standard`; a map does not, and its keys are media types (contain `/`).
 */
export function isContentTypeRequestMap(
  request: unknown,
): request is RequestContentTypeMap {
  if (typeof request !== 'object' || request === null) {
    return false;
  }
  if ('~standard' in request) {
    return false;
  }
  const keys = Object.keys(request);
  return keys.length > 0 && keys.every((key) => key.includes('/'));
}

/**
 * Normalize a `Content-Type` header to its media type, dropping parameters
 * (`; charset=...`, `; boundary=...`) and casing. Returns `null` when absent.
 */
export function normalizeContentType(
  header: string | string[] | undefined,
): string | null {
  if (!header) {
    return null;
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    return null;
  }
  const mediaType = value.split(';')[0]?.trim().toLowerCase();
  return mediaType || null;
}
