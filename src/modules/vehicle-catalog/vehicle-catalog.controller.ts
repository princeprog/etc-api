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

import { Roles } from '../../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateVehicleBrandDto } from './dto/create-vehicle-brand.dto';
import { CreateVehicleModelDto } from './dto/create-vehicle-model.dto';
import { CreateVehicleVariantDto } from './dto/create-vehicle-variant.dto';
import { ListVehicleBrandsQueryDto } from './dto/list-vehicle-brands-query.dto';
import { ListVehicleModelsQueryDto } from './dto/list-vehicle-models-query.dto';
import { ListVehicleVariantsQueryDto } from './dto/list-vehicle-variants-query.dto';
import { UpdateVehicleCatalogItemDto } from './dto/update-vehicle-catalog-item.dto';
import { VehicleCatalogService } from './vehicle-catalog.service';

@UseGuards(AccessTokenGuard)
@Controller('vehicle-catalog')
export class VehicleCatalogController {
  constructor(private readonly vehicleCatalogService: VehicleCatalogService) {}

  @Get('brands')
  listBrands(@Query() query: ListVehicleBrandsQueryDto) {
    return this.vehicleCatalogService.listBrands(query);
  }

  @Post('brands')
  createBrand(@Body() dto: CreateVehicleBrandDto) {
    return this.vehicleCatalogService.createBrand(dto);
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Patch('brands/:id')
  updateBrand(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleCatalogItemDto,
  ) {
    return this.vehicleCatalogService.updateBrand(id, dto);
  }

  @Get('models')
  listModels(@Query() query: ListVehicleModelsQueryDto) {
    return this.vehicleCatalogService.listModels(query.brandId, query);
  }

  @Post('models')
  createModel(@Body() dto: CreateVehicleModelDto) {
    return this.vehicleCatalogService.createModel(dto);
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Patch('models/:id')
  updateModel(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleCatalogItemDto,
  ) {
    return this.vehicleCatalogService.updateModel(id, dto);
  }

  @Get('variants')
  listVariants(@Query() query: ListVehicleVariantsQueryDto) {
    return this.vehicleCatalogService.listVariants(query.modelId, query);
  }

  @Post('variants')
  createVariant(@Body() dto: CreateVehicleVariantDto) {
    return this.vehicleCatalogService.createVariant(dto);
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Patch('variants/:id')
  updateVariant(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleCatalogItemDto,
  ) {
    return this.vehicleCatalogService.updateVariant(id, dto);
  }
}
