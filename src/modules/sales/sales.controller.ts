import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import { CreateSaleDraftDto } from './dto/create-sale-draft.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { UpdateSaleDraftDto } from './dto/update-sale-draft.dto';
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

  @Get('summary')
  getSummary(@Query() query: ListSalesQueryDto) {
    return this.salesService.getSummary(query);
  }

  @Post('drafts')
  saveDraft(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateSaleDraftDto,
  ) {
    return this.salesService.saveDraft(user, dto);
  }

  @Patch('drafts/:id')
  updateDraft(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateSaleDraftDto,
  ) {
    return this.salesService.updateDraft(user, id, dto);
  }

  @Delete('drafts/:id')
  deleteDraft(@Param('id') id: string) {
    return this.salesService.deleteDraft(id);
  }

  @Post('drafts/:id/finalize')
  finalizeDraft(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.salesService.finalizeDraft(user, id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }
}
