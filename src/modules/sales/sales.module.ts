import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [DatabaseModule, AuthModule, VehiclesModule, ActivityHistoryModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
