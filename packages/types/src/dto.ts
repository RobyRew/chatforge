import { z } from 'zod';
import { ExportFormatIdSchema, PlatformIdSchema } from './platforms';
import { FidelityReportSchema } from './report';

/**
 * Metadata for a saved conversion. Contains **no plaintext** — the actual converted
 * artifact lives in object storage as an E2E-encrypted blob referenced by `blobRef`.
 * This is what the API/admin layer is allowed to see.
 */
export const ConversionRecordSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  source: PlatformIdSchema,
  target: ExportFormatIdSchema,
  messageCount: z.number().int().nonnegative(),
  participantCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  report: FidelityReportSchema.optional(),
  /** Pointer to the encrypted artifact in object storage (ciphertext only). */
  blobRef: z.string().optional(),
  createdAt: z.number().int(),
});
export type ConversionRecord = z.infer<typeof ConversionRecordSchema>;
