import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { ConvertSellerLeadDto } from './dto/convert-seller-lead.dto';
import { CreateSellerLeadDto } from './dto/create-seller-lead.dto';
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
  findAll() {
    return this.sellerLeadsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sellerLeadsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSellerLeadDto: UpdateSellerLeadDto) {
    return this.sellerLeadsService.update(id, updateSellerLeadDto);
  }

  @Post(':id/convert')
  convert(@Param('id') id: string, @Body() convertSellerLeadDto: ConvertSellerLeadDto) {
    return this.sellerLeadsService.convert(id, convertSellerLeadDto);
  }
}
