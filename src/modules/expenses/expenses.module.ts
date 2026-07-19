import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ActivityHistoryModule } from '../activity-history/activity-history.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseRecurringRulesController } from './expense-recurring-rules.controller';
import { ExpenseRecurringRulesService } from './expense-recurring-rules.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [AuthModule, ActivityHistoryModule, NotificationsModule],
  controllers: [
    ExpensesController,
    ExpenseCategoriesController,
    ExpenseRecurringRulesController,
  ],
  providers: [
    ExpensesService,
    ExpenseCategoriesService,
    ExpenseRecurringRulesService,
  ],
  exports: [
    ExpensesService,
    ExpenseCategoriesService,
    ExpenseRecurringRulesService,
  ],
})
export class ExpensesModule {}
