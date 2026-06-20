import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BuyerLeadsModule } from './modules/buyer_leads/buyer_leads.module';

@Module({
  imports: [DatabaseModule, AuthModule, BuyerLeadsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
