import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { BuyerLeadsService } from './buyer_leads.service';
import { BuyerLeadsController } from './buyer_leads.controller';

@Module({
  imports: [AuthModule, ActivityHistoryModule],
  controllers: [BuyerLeadsController],
  providers: [BuyerLeadsService],
})
export class BuyerLeadsModule {}
