/** Shallow-merge only the defined keys of `patch` onto `base` — `exactOptionalPropertyTypes` safe. */
export function mergeDefined<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined }): T {
  const result = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
