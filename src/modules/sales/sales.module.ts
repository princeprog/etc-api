import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { VehiclesService } from '../vehicles/vehicles.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SalesController],
  providers: [SalesService, VehiclesService],
})
export class SalesModule {}
