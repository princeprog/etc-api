import { Module } from '@nestjs/common';

import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import { AuthModule } from '../auth/auth.module';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [LocalFileStorageService],
  exports: [LocalFileStorageService],
})
export class UploadsModule {}
