import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { BuyerLeadsService } from './buyer_leads.service';
import { CreateBuyerLeadDto } from './dto/create-buyer_lead.dto';
import { ListBuyerLeadsQueryDto } from './dto/list-buyer-leads-query.dto';
import { LinkBuyerLeadVehicleDto } from './dto/link-buyer-lead-vehicle.dto';
import { UpdateBuyerLeadDto } from './dto/update-buyer_lead.dto';

@UseGuards(AccessTokenGuard)
@Controller('buyer-leads')
export class BuyerLeadsController {
  constructor(private readonly buyerLeadsService: BuyerLeadsService) {}

  @Post()
  create(@Body() createBuyerLeadDto: CreateBuyerLeadDto) {
    return this.buyerLeadsService.create(createBuyerLeadDto);
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
    @Param('id') id: string,
    @Body() updateBuyerLeadDto: UpdateBuyerLeadDto,
  ) {
    return this.buyerLeadsService.update(id, updateBuyerLeadDto);
  }

  @Post(':id/vehicle-links')
  linkVehicle(@Param('id') id: string, @Body() dto: LinkBuyerLeadVehicleDto) {
    return this.buyerLeadsService.linkVehicle(id, dto);
  }

  @Delete(':id/vehicle-links/:vehicleId')
  unlinkVehicle(
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.buyerLeadsService.unlinkVehicle(id, vehicleId);
  }
}
