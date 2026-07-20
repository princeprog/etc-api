import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CloudinaryStorageService } from '../../common/storage/cloudinary-storage.service';
import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import { VehiclePhotoStorageService } from '../../common/storage/vehicle-photo-storage.service';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';

@Module({
  imports: [AuthModule, ActivityHistoryModule, NotificationsModule],
  controllers: [VehiclesController],
  providers: [
    VehiclesService,
    CloudinaryStorageService,
    LocalFileStorageService,
    VehiclePhotoStorageService,
  ],
  exports: [VehiclesService],
})
export class VehiclesModule {}
