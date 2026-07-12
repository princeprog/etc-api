import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VehicleCatalogController } from './vehicle-catalog.controller';
import { VehicleCatalogService } from './vehicle-catalog.service';

@Module({
  imports: [AuthModule],
  controllers: [VehicleCatalogController],
  providers: [VehicleCatalogService],
})
export class VehicleCatalogModule {}
