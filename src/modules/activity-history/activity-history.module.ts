import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryController } from './activity-history.controller';
import { ActivityHistoryService } from './activity-history.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ActivityHistoryController],
  providers: [ActivityHistoryService],
  exports: [ActivityHistoryService],
})
export class ActivityHistoryModule {}
