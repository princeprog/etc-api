import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BuyerLeadsModule } from './modules/buyer_leads/buyer_leads.module';
import { SellerLeadsModule } from './modules/seller-leads/seller-leads.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module';
import { SalesModule } from './modules/sales/sales.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { ActivityHistoryModule } from './modules/activity-history/activity-history.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    BuyerLeadsModule,
    SellerLeadsModule,
    VehiclesModule,
    FollowUpsModule,
    SalesModule,
    DashboardModule,
    ReportsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
