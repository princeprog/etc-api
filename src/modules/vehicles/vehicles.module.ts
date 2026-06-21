import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';

@Module({
  imports: [AuthModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, LocalFileStorageService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
