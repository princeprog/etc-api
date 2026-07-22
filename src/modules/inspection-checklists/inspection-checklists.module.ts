import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { InspectionChecklistsController } from './inspection-checklists.controller';
import { InspectionChecklistsService } from './inspection-checklists.service';

@Module({
  imports: [AuthModule, ActivityHistoryModule],
  controllers: [InspectionChecklistsController],
  providers: [InspectionChecklistsService],
})
export class InspectionChecklistsModule {}
