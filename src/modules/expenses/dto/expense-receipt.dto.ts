export class ExpenseReceiptDto {
  fileUrl?: string;
  publicId?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  fileSize?: number | string | null;
}
