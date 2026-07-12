import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { CreateVehicleBrandDto } from './dto/create-vehicle-brand.dto';
import { CreateVehicleModelDto } from './dto/create-vehicle-model.dto';
import { CreateVehicleVariantDto } from './dto/create-vehicle-variant.dto';
import { ListVehicleModelsQueryDto } from './dto/list-vehicle-models-query.dto';
import { ListVehicleVariantsQueryDto } from './dto/list-vehicle-variants-query.dto';
import { VehicleCatalogService } from './vehicle-catalog.service';

@UseGuards(AccessTokenGuard)
@Controller('vehicle-catalog')
export class VehicleCatalogController {
  constructor(private readonly vehicleCatalogService: VehicleCatalogService) {}

  @Get('brands')
  listBrands() {
    return this.vehicleCatalogService.listBrands();
  }

  @Post('brands')
  createBrand(@Body() dto: CreateVehicleBrandDto) {
    return this.vehicleCatalogService.createBrand(dto);
  }

  @Get('models')
  listModels(@Query() query: ListVehicleModelsQueryDto) {
    return this.vehicleCatalogService.listModels(query.brandId);
  }

  @Post('models')
  createModel(@Body() dto: CreateVehicleModelDto) {
    return this.vehicleCatalogService.createModel(dto);
  }

  @Get('variants')
  listVariants(@Query() query: ListVehicleVariantsQueryDto) {
    return this.vehicleCatalogService.listVariants(query.modelId);
  }

  @Post('variants')
  createVariant(@Body() dto: CreateVehicleVariantDto) {
    return this.vehicleCatalogService.createVariant(dto);
  }
}
