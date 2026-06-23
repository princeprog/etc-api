import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { SellerLeadsService } from './seller-leads.service';
import { SellerLeadsController } from './seller-leads.controller';
import { VehiclesModule } from '../vehicles/vehicles.module';

@Module({
  imports: [AuthModule, VehiclesModule, ActivityHistoryModule],
  controllers: [SellerLeadsController],
  providers: [SellerLeadsService],
})
export class SellerLeadsModule {}
