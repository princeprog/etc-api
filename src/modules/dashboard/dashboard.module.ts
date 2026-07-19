import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ReportsModule } from '../reports/reports.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [DatabaseModule, AuthModule, ExpensesModule, ReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
