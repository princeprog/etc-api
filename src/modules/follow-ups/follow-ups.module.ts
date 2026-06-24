import { Module } from '@nestjs/common';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { AuthModule } from '../auth/auth.module';
import { FollowUpsService } from './follow-ups.service';
import { FollowUpsController } from './follow-ups.controller';

@Module({
  imports: [AuthModule, ActivityHistoryModule],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
})
export class FollowUpsModule {}
