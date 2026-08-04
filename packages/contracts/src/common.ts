import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 7;

/** An unsigned 0-100 intensity/quality scale used throughout the sim. */
export const scale100Schema = z.number().int().min(0).max(100);

/** A signed -100..100 scale for directional quantities (momentum, sentiment deltas). */
export const deltaScale100Schema = z.number().int().min(-100).max(100);

export const idSchema = z.string().min(1);

export const tickSchema = z.number().int().nonnegative();
