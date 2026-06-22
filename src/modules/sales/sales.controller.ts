import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { SalesService } from './sales.service';

@UseGuards(AccessTokenGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateSaleDto) {
    return this.salesService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: ListSalesQueryDto) {
    return this.salesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }
}
