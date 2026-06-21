import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Controller('uploads')
@UseGuards(AccessTokenGuard)
export class UploadsController {
  constructor(private readonly localFileStorageService: LocalFileStorageService) {}

  @Post('vehicle-photos')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
      },
    }),
  )
  async uploadVehiclePhoto(
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Photo file is required');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only JPG, JPEG, PNG, and WEBP images are allowed');
    }

    const storedFile = await this.localFileStorageService.saveUserFile({
      userId: user.id,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    return {
      file: {
        path: storedFile.relativePath,
        url: `${request.protocol}://${request.get('host')}${storedFile.relativePath}`,
        filename: storedFile.filename,
        mimeType: storedFile.mimeType,
        size: storedFile.size,
      },
    };
  }
}
