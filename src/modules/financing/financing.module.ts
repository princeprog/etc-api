import { Module } from '@nestjs/common';

import { CloudinaryStorageService } from '../../common/storage/cloudinary-storage.service';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { AuthModule } from '../auth/auth.module';
import { FinancingController } from './financing.controller';
import { FinancingService } from './financing.service';
import { PublicFinancingUploadsController } from './public-financing-uploads.controller';

@Module({
  imports: [ActivityHistoryModule, AuthModule],
  controllers: [FinancingController, PublicFinancingUploadsController],
  providers: [FinancingService, CloudinaryStorageService],
  exports: [FinancingService],
})
export class FinancingModule {}
