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
import { ConvertSellerLeadDto } from './dto/convert-seller-lead.dto';
import { CreateSellerLeadDto } from './dto/create-seller-lead.dto';
import { ListSellerLeadsQueryDto } from './dto/list-seller-leads-query.dto';
import { SellerLeadEstimatedCostDto } from './dto/seller-lead-estimated-cost.dto';
import { UpdateSellerLeadDto } from './dto/update-seller-lead.dto';
import { SellerLeadsService } from './seller-leads.service';

@UseGuards(AccessTokenGuard)
@Controller('seller-leads')
export class SellerLeadsController {
  constructor(private readonly sellerLeadsService: SellerLeadsService) {}

  @Post()
  create(@Body() createSellerLeadDto: CreateSellerLeadDto) {
    return this.sellerLeadsService.create(createSellerLeadDto);
  }

  @Get()
  findAll(@Query() query: ListSellerLeadsQueryDto) {
    return this.sellerLeadsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sellerLeadsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateSellerLeadDto: UpdateSellerLeadDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.sellerLeadsService.update(id, updateSellerLeadDto, user);
  }

  @Post(':id/estimated-costs')
  createEstimatedCost(
    @Param('id') id: string,
    @Body() dto: SellerLeadEstimatedCostDto,
  ) {
    return this.sellerLeadsService.createEstimatedCost(id, dto);
  }

  @Delete(':id/estimated-costs/:costId')
  deleteEstimatedCost(@Param('id') id: string, @Param('costId') costId: string) {
    return this.sellerLeadsService.deleteEstimatedCost(id, costId);
  }

  @Post(':id/convert')
  convert(
    @Param('id') id: string,
    @Body() convertSellerLeadDto: ConvertSellerLeadDto,
  ) {
    return this.sellerLeadsService.convert(id, convertSellerLeadDto);
  }
}
