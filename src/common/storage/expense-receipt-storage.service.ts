import { Injectable } from '@nestjs/common';

import { CloudinaryStorageService } from './cloudinary-storage.service';
import type { FileStorageSaveInput } from './storage.types';

@Injectable()
export class ExpenseReceiptStorageService {
  constructor(
    private readonly cloudinaryStorageService: CloudinaryStorageService,
  ) {}

  saveUserFile(input: FileStorageSaveInput) {
    return this.cloudinaryStorageService.saveUserFile({
      ...input,
      folder: `etc-cars/users/${input.userId}/expense-receipts`,
      resourceType: 'auto',
    });
  }

  deleteFiles(pathsOrUrls: string[]) {
    return this.cloudinaryStorageService.deleteFiles(pathsOrUrls);
  }
}
