import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BuyerLeadsModule } from './modules/buyer_leads/buyer_leads.module';
import { SellerLeadsModule } from './modules/seller-leads/seller-leads.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module';

@Module({
  imports: [DatabaseModule, AuthModule, BuyerLeadsModule, SellerLeadsModule, VehiclesModule, FollowUpsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
