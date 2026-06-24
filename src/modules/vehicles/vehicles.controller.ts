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

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListVehiclesQueryDto } from './dto/list-vehicles-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { UpdateVehicleTrackedCostDto } from './dto/update-vehicle-tracked-cost.dto';
import { VehicleTrackedCostDto } from './dto/vehicle-tracked-cost.dto';
import { VehiclesService } from './vehicles.service';

@UseGuards(AccessTokenGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  create(@Body() createVehicleDto: CreateVehicleDto) {
    return this.vehiclesService.create(createVehicleDto);
  }

  @Get()
  findAll(@Query() query: ListVehiclesQueryDto) {
    return this.vehiclesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVehicleDto: UpdateVehicleDto) {
    return this.vehiclesService.update(id, updateVehicleDto);
  }

  @Post(':id/tracked-costs')
  createTrackedCost(
    @Param('id') id: string,
    @Body() dto: VehicleTrackedCostDto,
  ) {
    return this.vehiclesService.createTrackedCost(id, dto);
  }

  @Patch(':id/tracked-costs/:costId')
  updateTrackedCost(
    @Param('id') id: string,
    @Param('costId') costId: string,
    @Body() dto: UpdateVehicleTrackedCostDto,
  ) {
    return this.vehiclesService.updateTrackedCost(id, costId, dto);
  }

  @Delete(':id/tracked-costs/:costId')
  deleteTrackedCost(@Param('id') id: string, @Param('costId') costId: string) {
    return this.vehiclesService.deleteTrackedCost(id, costId);
  }
}
