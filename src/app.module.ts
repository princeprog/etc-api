import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { VehicleCatalogModule } from './modules/vehicle-catalog/vehicle-catalog.module';
import { LeadPipelineModule } from './modules/lead-pipeline/lead-pipeline.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InspectionChecklistsModule } from './modules/inspection-checklists/inspection-checklists.module';
import { RolesModule } from './modules/roles/roles.module';
import { FinancingModule } from './modules/financing/financing.module';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(),
    AuthModule,
    BuyerLeadsModule,
    SellerLeadsModule,
    VehiclesModule,
    FollowUpsModule,
    SalesModule,
    DashboardModule,
    ReportsModule,
    UploadsModule,
    ActivityHistoryModule,
    VehicleCatalogModule,
    LeadPipelineModule,
    ExpensesModule,
    NotificationsModule,
    InspectionChecklistsModule,
    RolesModule,
    FinancingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
