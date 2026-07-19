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
import { Roles } from '../../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { MarkExpensePaidDto } from './dto/mark-expense-paid.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { VoidExpenseDto } from './dto/void-expense.dto';
import { ExpensesService } from './expenses.service';

@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  list(@Query() query: ListExpensesQueryDto) {
    return this.expensesService.list(query);
  }

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(user, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(user, id, dto);
  }

  @Post(':id/mark-paid')
  @Roles('admin')
  markPaid(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: MarkExpensePaidDto,
  ) {
    return this.expensesService.markPaid(user, id, dto);
  }

  @Post(':id/void')
  @Roles('admin')
  void(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: VoidExpenseDto,
  ) {
    return this.expensesService.void(user, id, dto);
  }
}
