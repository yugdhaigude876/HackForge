import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createErrorResponse } from "./with-auth";
import { clampLimit } from "./repositories/common";

/**
 * Maximum permitted request body size in bytes (64 KB).
 * Rationale: The largest legitimate payload in Reserve Juggler is a multi-instrument
 * decision request or a detailed stress simulation scenario (~15–30 KB). 64 KB provides
 * >2x headroom while strictly bounding memory consumption against payload-flooding DoS.
 */
export const MAX_BODY_SIZE_BYTES = 64 * 1024;

/**
 * ID validation pattern matching Firestore repository constraints.
 * Restricts segment to alphanumeric characters, underscores, and hyphens (1–64 chars).
 * Prevents path traversal (e.g. "../", ".."), null-byte injection, and URI manipulation.
 */
export const ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export const IdSchema = z
  .string()
  .trim()
  .min(1, "ID cannot be empty")
  .max(64, "ID must be at most 64 characters")
  .regex(ID_REGEX, "ID must contain only alphanumeric characters, underscores, or hyphens");

/**
 * Validates a route path or ID parameter against strict regex rules.
 * Throws a formatted validation error if invalid.
 */
export function validatePathId(id: unknown, fieldName = "id"): string {
  if (typeof id !== "string" || !id || !ID_REGEX.test(id)) {
    throw new IdValidationError(
      `Invalid ${fieldName}: must match pattern ^[A-Za-z0-9_-]{1,64}$, received "${String(id)}"`
    );
  }
  return id;
}

export class IdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdValidationError";
  }
}

export interface ParseBodyOptions {
  maxBytes?: number;
}

export type ParseBodyResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

/**
 * Shared request guard for mutating routes (POST / PUT / PATCH):
 * 1. Rejects non-application/json Content-Type with 415 Unsupported Media Type.
 * 2. Enforces maximum payload body size (default 64 KB) with 413 Payload Too Large before parsing.
 * 3. Safely parses JSON and validates against provided Zod schema (with .strict() support).
 * 4. Returns standard error envelope on failure.
 */
export async function parseJsonBody<T = unknown>(
  request: NextRequest,
  schema?: z.ZodType<T>,
  options: ParseBodyOptions = {}
): Promise<ParseBodyResult<T>> {
  const maxBytes = options.maxBytes ?? MAX_BODY_SIZE_BYTES;

  // 1. Enforce Content-Type header
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().includes("application/json")) {
    return {
      success: false,
      response: createErrorResponse(
        415,
        "VALIDATION_ERROR",
        "Unsupported Media Type: Request Content-Type must be application/json"
      ),
    };
  }

  // 2. Enforce Content-Length header before reading body if present
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const parsedLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > maxBytes) {
      return {
        success: false,
        response: createErrorResponse(
          413,
          "VALIDATION_ERROR",
          `Payload Too Large: Request body size (${parsedLength} bytes) exceeds limit of ${maxBytes} bytes.`
        ),
      };
    }
  }

  // 3. Read body text and verify byte length
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return {
      success: false,
      response: createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Failed to read request body stream."
      ),
    };
  }

  const actualBytes = Buffer.byteLength(rawText, "utf-8");
  if (actualBytes > maxBytes) {
    return {
      success: false,
      response: createErrorResponse(
        413,
        "VALIDATION_ERROR",
        `Payload Too Large: Request body size (${actualBytes} bytes) exceeds limit of ${maxBytes} bytes.`
      ),
    };
  }

  // 4. Parse JSON
  let parsedJson: unknown;
  try {
    parsedJson = rawText.trim().length === 0 ? {} : JSON.parse(rawText);
  } catch {
    return {
      success: false,
      response: createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Invalid JSON in request body"
      ),
    };
  }

  // 5. Schema validation if schema supplied
  if (schema) {
    const parseResult = schema.safeParse(parsedJson);
    if (!parseResult.success) {
      return {
        success: false,
        response: createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Invalid request payload structure.",
          parseResult.error.issues
        ),
      };
    }
    return { success: true, data: parseResult.data };
  }

  return { success: true, data: parsedJson as T };
}

/**
 * Validates pagination 'limit' query parameter with Zod and clamps to [min, max].
 */
export function validatePaginationLimit(
  searchParams: URLSearchParams,
  defaultLimit = 20,
  maxLimit = 100
): { limit: number } | { errorResponse: NextResponse } {
  const rawLimit = searchParams.get("limit");
  if (rawLimit === null) {
    return { limit: defaultLimit };
  }

  const LimitSchema = z.coerce
    .number()
    .int("Query parameter 'limit' must be an integer")
    .positive("Query parameter 'limit' must be a positive integer");

  const parseResult = LimitSchema.safeParse(rawLimit);
  if (!parseResult.success) {
    return {
      errorResponse: createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Query parameter 'limit' must be a positive integer.",
        parseResult.error.issues
      ),
    };
  }

  return { limit: clampLimit(parseResult.data, defaultLimit, maxLimit) };
}
