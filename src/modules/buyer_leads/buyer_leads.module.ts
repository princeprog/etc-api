import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuyerLeadsService } from './buyer_leads.service';
import { BuyerLeadsController } from './buyer_leads.controller';

@Module({
  imports: [AuthModule],
  controllers: [BuyerLeadsController],
  providers: [BuyerLeadsService],
})
export class BuyerLeadsModule {}
