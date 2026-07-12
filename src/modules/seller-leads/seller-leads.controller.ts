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
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as AuthUser } from '../../common/types/auth.types';
import { ConvertSellerLeadDto } from './dto/convert-seller-lead.dto';
import { CreateSellerLeadDto } from './dto/create-seller-lead.dto';
import { ListSellerLeadsQueryDto } from './dto/list-seller-leads-query.dto';
import { UpdateSellerLeadDto } from './dto/update-seller-lead.dto';
import { SellerLeadsService } from './seller-leads.service';

@UseGuards(AccessTokenGuard)
@Controller('seller-leads')
export class SellerLeadsController {
  constructor(private readonly sellerLeadsService: SellerLeadsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() createSellerLeadDto: CreateSellerLeadDto,
  ) {
    return this.sellerLeadsService.create(user, createSellerLeadDto);
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
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() updateSellerLeadDto: UpdateSellerLeadDto,
  ) {
    return this.sellerLeadsService.update(id, updateSellerLeadDto, user);
  }

  @Post(':id/convert')
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() convertSellerLeadDto: ConvertSellerLeadDto,
  ) {
    return this.sellerLeadsService.convert(user, id, convertSellerLeadDto);
  }
}
