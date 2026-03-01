import { z } from 'zod'

/**
 * Safely parse Supabase response data with a zod schema.
 * Returns parsed data on success, or the raw data on validation failure
 * (with a console warning in development).
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  if (import.meta.env.DEV) {
    console.warn('[validate] Schema mismatch:', result.error.issues)
  }
  return data as T
}

/**
 * Safely parse an array of items.
 */
export function safeParseArray<T>(schema: z.ZodType<T>, data: unknown[]): T[] {
  return data.map(item => safeParse(schema, item))
}
