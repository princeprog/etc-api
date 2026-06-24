import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { VehicleStatus } from '../../database/schema';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListVehiclesQueryDto } from './dto/list-vehicles-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import {
  formatVehicleStockNumber,
  mapVehicleResponse,
  normalizeVehiclePhotos,
  parseVehicleStatus,
  validateVehicleAvailability,
} from './vehicles.helpers';
import type { VehiclePhotoInput, VehicleWriteModel } from './vehicles.types';

@Injectable()
export class VehiclesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly localFileStorageService: LocalFileStorageService,
  ) {}

  async create(createVehicleDto: CreateVehicleDto) {
    const model = this.buildVehicleCreateModel({
      brand: createVehicleDto.brand,
      model: createVehicleDto.model,
      year: createVehicleDto.year,
      variant: createVehicleDto.variant,
      mileage: createVehicleDto.mileage,
      transmission: createVehicleDto.transmission,
      fuelType: createVehicleDto.fuelType,
      color: createVehicleDto.color,
      region: createVehicleDto.region,
      features: createVehicleDto.features,
      remarks: createVehicleDto.remarks,
      purchasePrice: createVehicleDto.purchasePrice,
      targetSellingPrice: createVehicleDto.targetSellingPrice,
      minimumAcceptablePrice: createVehicleDto.minimumAcceptablePrice,
      acquisitionSource: createVehicleDto.acquisitionSource,
      sellerLeadId: createVehicleDto.sellerLeadId,
      status: createVehicleDto.status,
      photos: createVehicleDto.photos,
    });

    const vehicle = await this.db.transaction().execute(async (trx) => {
      const stockNumber = await this.allocateStockNumber(trx);
      const insertedVehicle = await trx
        .insertInto('inventory.vehicles')
        .values({
          stock_number: stockNumber,
          brand: model.brand,
          model: model.model,
          year: model.year,
          variant: model.variant,
          mileage: model.mileage,
          transmission: model.transmission,
          fuel_type: model.fuelType,
          color: model.color,
          region: model.region,
          features: model.features,
          remarks: model.remarks,
          purchase_price: model.purchasePrice,
          target_selling_price: model.targetSellingPrice,
          minimum_acceptable_price: model.minimumAcceptablePrice,
          acquisition_source: model.acquisitionSource,
          seller_lead_id: model.sellerLeadId,
          status: model.status,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.replacePhotos(trx, insertedVehicle.id, model.photos);
      return this.getVehicleOrThrow(insertedVehicle.id, trx);
    });

    return { vehicle };
  }

  async findAll(query?: ListVehiclesQueryDto) {
    let vehiclesQuery = this.db.selectFrom('inventory.vehicles').select(['id']);

    if (query?.status) {
      vehiclesQuery = vehiclesQuery.where(
        'status',
        '=',
        parseVehicleStatus(query.status, 'Incoming'),
      );
    }

    const vehicleIds = await vehiclesQuery
      .orderBy('created_at', 'desc')
      .execute();

    const vehicles = await Promise.all(
      vehicleIds.map((vehicle) => this.getVehicleOrThrow(vehicle.id)),
    );
    return { vehicles };
  }

  async findOne(id: string) {
    const vehicle = await this.getVehicleOrThrow(id);
    return { vehicle };
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    const existingVehicle = await this.db
      .selectFrom('inventory.vehicles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existingVehicle) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }

    const existingPhotos = await this.getVehiclePhotos(id);
    const model = this.buildVehicleCreateModel({
      stockNumber: updateVehicleDto.stockNumber ?? existingVehicle.stock_number,
      brand: updateVehicleDto.brand ?? existingVehicle.brand,
      model: updateVehicleDto.model ?? existingVehicle.model,
      year: updateVehicleDto.year ?? existingVehicle.year,
      variant: updateVehicleDto.variant ?? existingVehicle.variant,
      mileage: updateVehicleDto.mileage ?? existingVehicle.mileage,
      transmission:
        updateVehicleDto.transmission ?? existingVehicle.transmission,
      fuelType: updateVehicleDto.fuelType ?? existingVehicle.fuel_type,
      color: updateVehicleDto.color ?? existingVehicle.color,
      region: updateVehicleDto.region ?? existingVehicle.region,
      features: updateVehicleDto.features ?? existingVehicle.features,
      remarks: updateVehicleDto.remarks ?? existingVehicle.remarks,
      purchasePrice:
        updateVehicleDto.purchasePrice ?? existingVehicle.purchase_price,
      targetSellingPrice:
        updateVehicleDto.targetSellingPrice ??
        existingVehicle.target_selling_price,
      minimumAcceptablePrice:
        updateVehicleDto.minimumAcceptablePrice ??
        existingVehicle.minimum_acceptable_price,
      acquisitionSource:
        updateVehicleDto.acquisitionSource ??
        existingVehicle.acquisition_source,
      sellerLeadId:
        updateVehicleDto.sellerLeadId ?? existingVehicle.seller_lead_id,
      status:
        updateVehicleDto.status ??
        parseVehicleStatus(existingVehicle.status, 'Incoming'),
      photos: updateVehicleDto.photos ?? existingPhotos,
    });
    const removedPhotoPaths = this.getRemovedPhotoPaths(
      existingPhotos,
      model.photos,
    );

    const vehicle = await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('inventory.vehicles')
        .set({
          stock_number: model.stockNumber,
          brand: model.brand,
          model: model.model,
          year: model.year,
          variant: model.variant,
          mileage: model.mileage,
          transmission: model.transmission,
          fuel_type: model.fuelType,
          color: model.color,
          region: model.region,
          features: model.features,
          remarks: model.remarks,
          purchase_price: model.purchasePrice,
          target_selling_price: model.targetSellingPrice,
          minimum_acceptable_price: model.minimumAcceptablePrice,
          acquisition_source: model.acquisitionSource,
          seller_lead_id: model.sellerLeadId,
          status: model.status,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      if (updateVehicleDto.photos) {
        await this.replacePhotos(trx, id, model.photos);
      }

      return this.getVehicleOrThrow(id, trx);
    });

    if (removedPhotoPaths.length > 0) {
      await this.localFileStorageService.deleteFiles(removedPhotoPaths);
    }

    return { vehicle };
  }

  buildVehicleCreateModel(input: {
    stockNumber?: string;
    brand: string;
    model: string;
    year: number | undefined;
    variant?: string | null;
    mileage?: number | null;
    transmission?: string | null;
    fuelType?: string | null;
    color?: string | null;
    region?: string | null;
    features?: string | null;
    remarks?: string | null;
    purchasePrice?: string | null;
    targetSellingPrice?: string | null;
    minimumAcceptablePrice?: string | null;
    acquisitionSource?: string | null;
    sellerLeadId?: string | null;
    status?: VehicleStatus;
    photos?: VehiclePhotoInput[];
  }): VehicleWriteModel {
    const stockNumber = input.stockNumber?.trim();
    const brand = input.brand?.trim();
    const model = input.model?.trim();

    if (!brand) {
      throw new BadRequestException('brand is required');
    }

    if (!model) {
      throw new BadRequestException('model is required');
    }

    if (!input.year) {
      throw new BadRequestException('year is required');
    }

    const normalized: VehicleWriteModel = {
      stockNumber: stockNumber ?? '',
      brand,
      model,
      year: Number(input.year),
      variant: input.variant ?? null,
      mileage: input.mileage ?? null,
      transmission: input.transmission ?? null,
      fuelType: input.fuelType ?? null,
      color: input.color ?? null,
      region: input.region ?? null,
      features: input.features ?? null,
      remarks: input.remarks ?? null,
      purchasePrice: input.purchasePrice ?? null,
      targetSellingPrice: input.targetSellingPrice ?? null,
      minimumAcceptablePrice: input.minimumAcceptablePrice ?? null,
      acquisitionSource: input.acquisitionSource ?? null,
      sellerLeadId: input.sellerLeadId ?? null,
      status: parseVehicleStatus(input.status, 'Incoming'),
      photos: normalizeVehiclePhotos(input.photos),
    };

    validateVehicleAvailability(normalized);
    return normalized;
  }

  private async getVehicleOrThrow(
    id: string,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const db = executor ?? this.db;
    const vehicle = await db
      .selectFrom('inventory.vehicles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }

    const photos = await this.getVehiclePhotos(id, executor);
    return mapVehicleResponse({
      ...vehicle,
      status: parseVehicleStatus(vehicle.status, 'Incoming'),
      photos,
    });
  }

  async allocateStockNumber(trx: Transaction<DB>, now = new Date()) {
    const stockYear = now.getUTCFullYear();

    await sql`select pg_advisory_xact_lock(${stockYear})`.execute(trx);

    const latestVehicleForYear = await trx
      .selectFrom('inventory.vehicles')
      .select(['stock_number'])
      .where(sql<boolean>`stock_number ~ '^ETC-[0-9]{4}-[0-9]+$'`)
      .where(
        sql<boolean>`split_part(stock_number, '-', 2)::integer = ${stockYear}`,
      )
      .orderBy(sql<number>`split_part(stock_number, '-', 3)::integer`, 'desc')
      .executeTakeFirst();

    if (!latestVehicleForYear?.stock_number) {
      return formatVehicleStockNumber(stockYear, 1);
    }

    const latestSequence = Number(
      latestVehicleForYear.stock_number.split('-').at(-1) ?? '0',
    );
    return formatVehicleStockNumber(stockYear, latestSequence + 1);
  }

  private async getVehiclePhotos(
    id: string,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const db = executor ?? this.db;
    const photos = await db
      .selectFrom('inventory.vehicle_photos')
      .select(['file_url', 'sort_order'])
      .where('vehicle_id', '=', id)
      .orderBy('sort_order', 'asc')
      .execute();

    return photos.map((photo) => ({
      fileUrl: photo.file_url,
      sortOrder: photo.sort_order,
    }));
  }

  private async replacePhotos(
    trx: Transaction<DB>,
    vehicleId: string,
    photos: VehiclePhotoInput[],
  ) {
    await trx
      .deleteFrom('inventory.vehicle_photos')
      .where('vehicle_id', '=', vehicleId)
      .execute();

    if (photos.length === 0) {
      return;
    }

    await trx
      .insertInto('inventory.vehicle_photos')
      .values(
        photos.map((photo) => ({
          vehicle_id: vehicleId,
          file_url: photo.fileUrl,
          sort_order: photo.sortOrder ?? 0,
        })),
      )
      .execute();
  }

  private getRemovedPhotoPaths(
    existingPhotos: VehiclePhotoInput[],
    nextPhotos: VehiclePhotoInput[],
  ) {
    const nextPhotoPaths = new Set(nextPhotos.map((photo) => photo.fileUrl));

    return existingPhotos
      .map((photo) => photo.fileUrl)
      .filter((fileUrl) => !nextPhotoPaths.has(fileUrl));
  }
}
