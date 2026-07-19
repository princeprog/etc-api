import { Injectable } from '@nestjs/common';

import { CloudinaryStorageService } from './cloudinary-storage.service';
import { LocalFileStorageService } from './local-file-storage.service';
import type { FileStorageSaveInput } from './storage.types';

@Injectable()
export class VehiclePhotoStorageService {
  constructor(
    private readonly cloudinaryStorageService: CloudinaryStorageService,
    private readonly localFileStorageService: LocalFileStorageService,
  ) {}

  saveUserFile(input: FileStorageSaveInput) {
    return this.cloudinaryStorageService.saveUserFile(input);
  }

  async deleteFiles(pathsOrUrls: string[]) {
    const localPaths = pathsOrUrls.filter((value) =>
      value.trim().startsWith('/uploads/'),
    );
    const cloudinaryUrls = pathsOrUrls.filter(
      (value) => !value.trim().startsWith('/uploads/'),
    );

    await Promise.all([
      this.localFileStorageService.deleteFiles(localPaths),
      this.cloudinaryStorageService.deleteFiles(cloudinaryUrls),
    ]);
  }
}
