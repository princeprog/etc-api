import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUser as AuthUser } from '../../common/types/auth.types';
import { BuyerLeadsService } from './buyer_leads.service';
import { CreateBuyerLeadDto } from './dto/create-buyer_lead.dto';
import { ListBuyerLeadsQueryDto } from './dto/list-buyer-leads-query.dto';
import { UpdateBuyerLeadDto } from './dto/update-buyer_lead.dto';

@UseGuards(AccessTokenGuard)
@Controller('buyer-leads')
export class BuyerLeadsController {
  constructor(private readonly buyerLeadsService: BuyerLeadsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() createBuyerLeadDto: CreateBuyerLeadDto) {
    return this.buyerLeadsService.create(user, createBuyerLeadDto);
  }

  @Get()
  findAll(@Query() query: ListBuyerLeadsQueryDto) {
    return this.buyerLeadsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.buyerLeadsService.findOne(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() updateBuyerLeadDto: UpdateBuyerLeadDto,
  ) {
    return this.buyerLeadsService.update(user, id, updateBuyerLeadDto);
  }

}
