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
import { ExpenseReceiptStorageService } from '../../common/storage/expense-receipt-storage.service';
import { VehiclePhotoStorageService } from '../../common/storage/vehicle-photo-storage.service';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_RECEIPT_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  'application/pdf',
];
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Controller('uploads')
@UseGuards(AccessTokenGuard)
export class UploadsController {
  constructor(
    private readonly vehiclePhotoStorageService: VehiclePhotoStorageService,
    private readonly expenseReceiptStorageService: ExpenseReceiptStorageService,
  ) {}

  @Post('vehicle-photos')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
      },
    }),
  )
  async uploadVehiclePhoto(
    @UploadedFile() file: UploadedFile | undefined,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Photo file is required');
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only JPG, JPEG, PNG, and WEBP images are allowed',
      );
    }

    const storedFile = await this.vehiclePhotoStorageService.saveUserFile({
      userId: user.id,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    return {
      file: {
        path: storedFile.relativePath,
        url:
          storedFile.url ??
          `${request.protocol}://${request.get('host')}${storedFile.relativePath}`,
        filename: storedFile.filename,
        mimeType: storedFile.mimeType,
        size: storedFile.size,
        publicId: storedFile.publicId,
        width: storedFile.width,
        height: storedFile.height,
        format: storedFile.format,
        optimizedUrl: storedFile.optimizedUrl,
      },
    };
  }

  @Post('expense-receipts')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
      },
    }),
  )
  async uploadExpenseReceipt(
    @UploadedFile() file: UploadedFile | undefined,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Receipt file is required');
    }

    if (!ALLOWED_RECEIPT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only JPG, JPEG, PNG, WEBP, and PDF receipts are allowed',
      );
    }

    const storedFile = await this.expenseReceiptStorageService.saveUserFile({
      userId: user.id,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    return {
      file: {
        path: storedFile.relativePath,
        url:
          storedFile.url ??
          `${request.protocol}://${request.get('host')}${storedFile.relativePath}`,
        filename: storedFile.filename,
        originalFilename: file.originalname,
        mimeType: storedFile.mimeType,
        size: storedFile.size,
        publicId: storedFile.publicId,
        width: storedFile.width,
        height: storedFile.height,
        format: storedFile.format,
        optimizedUrl: storedFile.optimizedUrl,
      },
    };
  }
}
