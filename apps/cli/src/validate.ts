import { ZodError, type ZodType } from "zod";

/** Parse with zod, turning a ZodError into a plain, CLI-friendly `Error`. */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown, context: string): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`${context}: ${err.issues.map((i) => i.message).join("; ")}`);
    }
    throw err;
  }
}
