import { z } from "zod";

export const publicWasteReportSchema = z.object({
  areaId: z.string().uuid(),
  binId: z.string().uuid().optional(),
  categoryId: z.coerce.number().int().positive(),
  description: z.string().trim().min(10).max(3000),
  reporterName: z.string().trim().max(120).optional(),
  reporterContact: z.string().trim().max(254).optional(),
  estimatedWeightKg: z.coerce.number().nonnegative().max(100000).optional()
}).strict();

export type PublicWasteReportInput = z.infer<typeof publicWasteReportSchema>;

export const uuidSchema = z.string().uuid();
