import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiResponse,
} from 'cloudinary';
import { extname, parse } from 'path';
import { randomUUID } from 'crypto';

import type {
  FileStorage,
  FileStorageSaveInput,
  StoredFile,
} from './storage.types';

@Injectable()
export class CloudinaryStorageService implements FileStorage, OnModuleInit {
  private configured = false;

  onModuleInit() {
    this.configure();
  }

  async saveUserFile(input: FileStorageSaveInput): Promise<StoredFile> {
    this.configure();

    const uploadResult = await this.uploadBuffer(input);
    const optimizedUrl = cloudinary.url(uploadResult.public_id, {
      secure: true,
      resource_type: uploadResult.resource_type,
      fetch_format: 'auto',
      quality: 'auto',
    });

    return {
      filename: this.getFilename(uploadResult),
      mimeType: input.mimeType,
      size: uploadResult.bytes,
      relativePath: uploadResult.secure_url,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      optimizedUrl,
    };
  }

  async savePrivateUserFile(input: FileStorageSaveInput): Promise<StoredFile> {
    this.configure();

    const uploadResult = await this.uploadBuffer(input, {
      type: 'authenticated',
      access_mode: 'authenticated',
    });

    return {
      filename: this.getFilename(uploadResult),
      mimeType: input.mimeType,
      size: uploadResult.bytes,
      relativePath: uploadResult.public_id,
      publicId: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
    };
  }

  createSignedUrl(
    publicId: string,
    input: {
      resourceType: 'image' | 'raw';
      expiresInSeconds: number;
    },
  ) {
    this.configure();

    return cloudinary.url(publicId, {
      secure: true,
      sign_url: true,
      type: 'authenticated',
      resource_type: input.resourceType,
      expires_at: Math.floor(Date.now() / 1000) + input.expiresInSeconds,
    });
  }

  async deleteFiles(relativePathsOrUrls: string[]) {
    this.configure();

    const publicIds = relativePathsOrUrls
      .map((value) => this.extractPublicId(value))
      .filter((publicId): publicId is string => Boolean(publicId));

    await Promise.all(
      publicIds.flatMap((publicId) =>
        (['image', 'raw'] as const).map((resourceType) =>
          cloudinary.uploader.destroy(publicId, {
            invalidate: true,
            resource_type: resourceType,
          }),
        ),
      ),
    );
  }

  private uploadBuffer(
    input: FileStorageSaveInput,
    options: Record<string, unknown> = {},
  ) {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: input.resourceType ?? 'image',
          ...options,
          folder:
            input.folder ?? `etc-cars/users/${input.userId}/vehicle-photos`,
          use_filename: false,
          unique_filename: true,
          filename_override: this.sanitizeFilename(input.originalName),
          context: {
            uploaded_by_user_id: input.userId,
            original_filename: input.originalName,
          },
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            reject(
              new InternalServerErrorException(
                `Cloudinary upload failed: ${error.message}`,
              ),
            );
            return;
          }

          if (!result) {
            reject(
              new InternalServerErrorException(
                'Cloudinary upload did not return a result',
              ),
            );
            return;
          }

          resolve(result);
        },
      );

      uploadStream.end(input.buffer);
    });
  }

  private extractPublicId(pathOrUrl: string) {
    const value = pathOrUrl.trim();

    if (!value || value.startsWith('/uploads/')) {
      return null;
    }

    try {
      const url = new URL(value);
      const uploadMarker =
        ['/image/upload/', '/raw/upload/'].find((marker) =>
          url.pathname.includes(marker),
        ) ?? null;

      if (!uploadMarker) {
        return null;
      }

      const uploadMarkerIndex = url.pathname.indexOf(uploadMarker);
      const pathAfterUpload = url.pathname.slice(
        uploadMarkerIndex + uploadMarker.length,
      );
      const publicIdWithFormat = pathAfterUpload.replace(/^v\d+\//, '');
      return publicIdWithFormat.replace(/\.[^/.]+$/, '');
    } catch {
      return value.replace(/\.[^/.]+$/, '');
    }
  }

  private getFilename(uploadResult: UploadApiResponse) {
    return uploadResult.format
      ? `${uploadResult.public_id}.${uploadResult.format}`
      : uploadResult.public_id;
  }

  private configure() {
    if (this.configured) {
      return;
    }

    cloudinary.config({
      cloud_name: this.requireEnv('CLOUDINARY_CLOUD_NAME'),
      api_key: this.requireEnv('CLOUDINARY_API_KEY'),
      api_secret: this.requireEnv('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    this.configured = true;
  }

  private sanitizeFilename(originalName: string) {
    const parsedName = parse(originalName);
    const baseName = parsedName.name || `upload-${randomUUID()}`;
    const extension = extname(originalName);

    return `${baseName.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}${extension}`;
  }

  private requireEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
  }
}
