import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import { CreateExpenseRecurringRuleDto } from './dto/create-expense-recurring-rule.dto';
import { ListExpenseRecurringRulesQueryDto } from './dto/list-expense-recurring-rules-query.dto';
import { UpdateExpenseRecurringRuleDto } from './dto/update-expense-recurring-rule.dto';
import { ExpenseRecurringRulesService } from './expense-recurring-rules.service';

@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller('expense-recurring-rules')
export class ExpenseRecurringRulesController {
  constructor(
    private readonly expenseRecurringRulesService: ExpenseRecurringRulesService,
  ) {}

  @Get()
  list(@Query() query: ListExpenseRecurringRulesQueryDto) {
    return this.expenseRecurringRulesService.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.expensesCreate)
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateExpenseRecurringRuleDto,
  ) {
    return this.expenseRecurringRulesService.create(user, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expenseRecurringRulesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.expensesUpdate)
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseRecurringRuleDto,
  ) {
    return this.expenseRecurringRulesService.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.expensesUpdate)
  deactivate(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.expenseRecurringRulesService.deactivate(user, id);
  }
}
