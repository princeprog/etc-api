import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpenseReportsService } from './expense-reports.service';
import { ExpenseRecurringRulesController } from './expense-recurring-rules.controller';
import { ExpenseRecurringRulesService } from './expense-recurring-rules.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [
    AuthModule,
    ActivityHistoryModule,
    NotificationsModule,
    UploadsModule,
  ],
  controllers: [
    ExpensesController,
    ExpenseCategoriesController,
    ExpenseRecurringRulesController,
    ExpenseReportsController,
  ],
  providers: [
    ExpensesService,
    ExpenseCategoriesService,
    ExpenseRecurringRulesService,
    ExpenseReportsService,
  ],
  exports: [
    ExpensesService,
    ExpenseCategoriesService,
    ExpenseRecurringRulesService,
    ExpenseReportsService,
  ],
})
export class ExpensesModule {}
