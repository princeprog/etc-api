import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';
import { LeadPipelineModule } from '../lead-pipeline/lead-pipeline.module';
import { SellerLeadsService } from './seller-leads.service';
import { SellerLeadsController } from './seller-leads.controller';
import { VehiclesModule } from '../vehicles/vehicles.module';

@Module({
  imports: [
    AuthModule,
    VehiclesModule,
    ActivityHistoryModule,
    LeadAssignmentModule,
    LeadPipelineModule,
  ],
  controllers: [SellerLeadsController],
  providers: [SellerLeadsService],
})
export class SellerLeadsModule {}
