import { Module } from '@nestjs/common';

import { CloudinaryStorageService } from '../../common/storage/cloudinary-storage.service';
import { ExpenseReceiptStorageService } from '../../common/storage/expense-receipt-storage.service';
import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import { VehiclePhotoStorageService } from '../../common/storage/vehicle-photo-storage.service';
import { AuthModule } from '../auth/auth.module';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [
    CloudinaryStorageService,
    ExpenseReceiptStorageService,
    LocalFileStorageService,
    VehiclePhotoStorageService,
  ],
  exports: [ExpenseReceiptStorageService, VehiclePhotoStorageService],
})
export class UploadsModule {}
