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
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { ExpenseCategoriesService } from './expense-categories.service';
import { parseBoolean } from './expenses.helpers';

@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(
    private readonly expenseCategoriesService: ExpenseCategoriesService,
  ) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.expenseCategoriesService.list({
      includeInactive: parseBoolean(includeInactive),
    });
  }

  @Post()
  @Roles('admin')
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateExpenseCategoryDto,
  ) {
    return this.expenseCategoriesService.create(user, dto);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.expenseCategoriesService.update(user, id, dto);
  }
}
