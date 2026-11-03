import { z } from 'zod';

/** Chính sách trẻ em nằm/ngồi chung (docs/SETUP-NHA-XE.md mục 3). */
export const childPolicySchema = z
  .object({
    freeUnderAge: z.number().int().min(0).max(16),
    price: z.number().int().min(0),
    maxPerUnit: z.number().int().min(0).max(2),
    countsTowardCapacity: z.boolean(),
  })
  .strict();
export type ChildPolicy = z.infer<typeof childPolicySchema>;

export const policyInputSchema = z
  .object({
    holdMinutes: z.number().int().min(1).max(120),
    maxUnitsPerBooking: z.number().int().min(1).max(20),
    childPolicy: childPolicySchema,
  })
  .strict();
export type PolicyInput = z.infer<typeof policyInputSchema>;

export interface OperatorPolicy extends PolicyInput {
  operatorId: string;
  version: number;
}

export const DEFAULT_POLICY: PolicyInput = {
  holdMinutes: 10,
  maxUnitsPerBooking: 5,
  childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
};
