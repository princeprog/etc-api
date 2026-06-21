import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

import type { FileStorage, FileStorageSaveInput, StoredFile } from './storage.types';

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class LocalFileStorageService implements FileStorage {
  async saveUserFile(input: FileStorageSaveInput): Promise<StoredFile> {
    const extension = this.resolveExtension(input.originalName, input.mimeType);
    const filename = `${randomUUID()}${extension}`;
    const directory = join(process.cwd(), 'uploads', 'users', input.userId);
    const absolutePath = join(directory, filename);

    await mkdir(directory, { recursive: true });
    await writeFile(absolutePath, input.buffer);

    return {
      filename,
      mimeType: input.mimeType,
      size: input.buffer.byteLength,
      relativePath: `/uploads/users/${input.userId}/${filename}`,
    };
  }

  async deleteFiles(relativePaths: string[]) {
    const normalizedPaths = relativePaths
      .map((path) => path.trim())
      .filter((path) => path.startsWith('/uploads/'));

    await Promise.all(
      normalizedPaths.map(async (relativePath) => {
        const absolutePath = join(
          process.cwd(),
          relativePath.replace(/^\/uploads\//, 'uploads/'),
        );

        try {
          await unlink(absolutePath);
        } catch (error) {
          const nodeError = error as NodeJS.ErrnoException;

          if (nodeError.code !== 'ENOENT') {
            throw error;
          }
        }
      }),
    );
  }

  private resolveExtension(originalName: string, mimeType: string) {
    const extension = extname(originalName).toLowerCase();
    return extension || MIME_TYPE_TO_EXTENSION[mimeType] || '.bin';
  }
}
