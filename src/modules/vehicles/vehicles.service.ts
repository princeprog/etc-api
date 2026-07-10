import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import {
  buildPaginatedResponse,
  parsePagination,
} from '../../common/utils/list-query.utils';
import type { CurrentUser } from '../../common/types/auth.types';
import { LocalFileStorageService } from '../../common/storage/local-file-storage.service';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { VehicleStatus } from '../../database/schema';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import type { ActivityHistoryMetadata } from '../activity-history/activity-history.types';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListVehicleTrackedCostsQueryDto } from './dto/list-vehicle-tracked-costs-query.dto';
import { ListVehiclesQueryDto } from './dto/list-vehicles-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import {
  formatVehicleStockNumber,
  mapVehicleResponse,
  normalizeTrackedCostAmount,
  normalizeTrackedCostNote,
  normalizeVehiclePhotos,
  parseVehicleTrackedCostCategory,
  parseVehicleStatus,
  validateVehicleAvailability,
} from './vehicles.helpers';
import type {
  VehiclePhotoInput,
  VehicleTrackedCostResponse,
  VehicleTrackedCostsPageResponse,
  VehicleWriteModel,
} from './vehicles.types';
import { centsToMoney, parseMoneyToCents } from '../sales/sales.helpers';

@Injectable()
export class VehiclesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly localFileStorageService: LocalFileStorageService,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async create(user: CurrentUser, createVehicleDto: CreateVehicleDto) {
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
      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'vehicle',
          entityId: insertedVehicle.id,
          actionType: 'vehicle.created',
          summary: 'Vehicle created',
          metadata: {
            stockNumber,
            status: model.status,
            sellerLeadId: model.sellerLeadId,
          },
        },
        trx,
      );
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

  async listTrackedCosts(
    vehicleId: string,
    query: ListVehicleTrackedCostsQueryDto = {},
  ): Promise<VehicleTrackedCostsPageResponse> {
    await this.ensureVehicleExists(vehicleId);

    const pagination = parsePagination(query);
    const baseQuery = this.db
      .selectFrom('inventory.vehicle_tracked_costs')
      .where('vehicle_id', '=', vehicleId);

    const totalRow = await baseQuery
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);

    const trackedCosts = await baseQuery
      .selectAll()
      .orderBy('created_at', 'asc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const response = buildPaginatedResponse(
      trackedCosts.map((cost) => this.mapVehicleTrackedCost(cost)),
      pagination,
      total,
    );

    return {
      trackedCosts: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async update(user: CurrentUser, id: string, updateVehicleDto: UpdateVehicleDto) {
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

      await this.writeUpdateActivity(user, existingVehicle, model, trx);

      return this.getVehicleOrThrow(id, trx);
    });

    if (removedPhotoPaths.length > 0) {
      await this.localFileStorageService.deleteFiles(removedPhotoPaths);
    }

    return { vehicle };
  }

  async createTrackedCost(
    vehicleId: string,
    dto: { category: string; amount: string; note: string },
  ) {
    await this.getVehicleOrThrow(vehicleId);

    await this.db
      .insertInto('inventory.vehicle_tracked_costs')
      .values({
        vehicle_id: vehicleId,
        category: parseVehicleTrackedCostCategory(dto.category),
        amount: normalizeTrackedCostAmount(dto.amount),
        note: normalizeTrackedCostNote(dto.note),
      })
      .executeTakeFirstOrThrow();

    return { vehicle: await this.getVehicleOrThrow(vehicleId) };
  }

  async updateTrackedCost(
    vehicleId: string,
    costId: string,
    dto: { category?: string; amount?: string; note?: string },
  ) {
    const current = await this.getTrackedCostOrThrow(vehicleId, costId);

    await this.db
      .updateTable('inventory.vehicle_tracked_costs')
      .set({
        category: parseVehicleTrackedCostCategory(
          dto.category,
          parseVehicleTrackedCostCategory(current.category),
        ),
        amount:
          dto.amount !== undefined
            ? normalizeTrackedCostAmount(dto.amount)
            : current.amount,
        note:
          dto.note !== undefined
            ? normalizeTrackedCostNote(dto.note)
            : current.note,
        updated_at: new Date(),
      })
      .where('id', '=', costId)
      .where('vehicle_id', '=', vehicleId)
      .execute();

    return { vehicle: await this.getVehicleOrThrow(vehicleId) };
  }

  async deleteTrackedCost(vehicleId: string, costId: string) {
    await this.getTrackedCostOrThrow(vehicleId, costId);

    await this.db
      .deleteFrom('inventory.vehicle_tracked_costs')
      .where('id', '=', costId)
      .where('vehicle_id', '=', vehicleId)
      .execute();

    return { vehicle: await this.getVehicleOrThrow(vehicleId) };
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
    const trackedCosts = await this.getVehicleTrackedCosts(id, executor);
    return mapVehicleResponse({
      ...vehicle,
      status: parseVehicleStatus(vehicle.status, 'Incoming'),
      photos,
      trackedCosts,
      trackedCostsTotal: this.sumTrackedCosts(trackedCosts),
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

  private async ensureVehicleExists(id: string) {
    const vehicle = await this.db
      .selectFrom('inventory.vehicles')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }
  }

  private async getVehicleTrackedCosts(
    id: string,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const db = executor ?? this.db;
    const trackedCosts = await db
      .selectFrom('inventory.vehicle_tracked_costs')
      .selectAll()
      .where('vehicle_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();

    return trackedCosts.map((cost) => this.mapVehicleTrackedCost(cost));
  }

  private mapVehicleTrackedCost(cost: {
    id: string;
    category: string;
    amount: string;
    note: string;
    created_at: Date;
    updated_at: Date;
  }): VehicleTrackedCostResponse {
    return {
      id: cost.id,
      category: parseVehicleTrackedCostCategory(cost.category),
      amount: cost.amount,
      note: cost.note,
      createdAt: cost.created_at,
      updatedAt: cost.updated_at,
    };
  }

  private sumTrackedCosts(trackedCosts: VehicleTrackedCostResponse[]) {
    return centsToMoney(
      trackedCosts.reduce(
        (sum, cost) =>
          sum + parseMoneyToCents(cost.amount, 'trackedCost.amount'),
        0,
      ),
    );
  }

  private async getTrackedCostOrThrow(vehicleId: string, costId: string) {
    const trackedCost = await this.db
      .selectFrom('inventory.vehicle_tracked_costs')
      .selectAll()
      .where('id', '=', costId)
      .where('vehicle_id', '=', vehicleId)
      .executeTakeFirst();

    if (!trackedCost) {
      throw new NotFoundException(
        `Tracked cost ${costId} was not found for vehicle ${vehicleId}`,
      );
    }

    return trackedCost;
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

  private async writeUpdateActivity(
    user: CurrentUser,
    previous: {
      id: string;
      status: string;
      stock_number: string;
      target_selling_price: string | null;
      minimum_acceptable_price: string | null;
      purchase_price: string | null;
      brand: string;
      model: string;
      remarks: string | null;
      features: string | null;
    },
    next: VehicleWriteModel,
    trx: Transaction<DB>,
  ) {
    const events: WriteActivityEvent[] = [];

    if (previous.status !== next.status) {
      events.push({
        actionType: 'vehicle.status_changed',
        summary: `Vehicle status changed from ${previous.status} to ${next.status}`,
        metadata: { from: previous.status, to: next.status },
      });
    }

    if (
      previous.target_selling_price !== next.targetSellingPrice ||
      previous.minimum_acceptable_price !== next.minimumAcceptablePrice ||
      previous.purchase_price !== next.purchasePrice
    ) {
      events.push({
        actionType: 'vehicle.pricing_updated',
        summary: 'Vehicle pricing updated',
        metadata: {
          changedFields: [
            previous.purchase_price !== next.purchasePrice ? 'purchasePrice' : null,
            previous.target_selling_price !== next.targetSellingPrice ? 'targetSellingPrice' : null,
            previous.minimum_acceptable_price !== next.minimumAcceptablePrice ? 'minimumAcceptablePrice' : null,
          ].filter(Boolean),
        },
      });
    }

    if (
      previous.brand !== next.brand ||
      previous.model !== next.model ||
      previous.stock_number !== next.stockNumber ||
      previous.remarks !== next.remarks ||
      previous.features !== next.features
    ) {
      events.push({
        actionType: 'vehicle.details_updated',
        summary: 'Vehicle merchandising details updated',
        metadata: {
          changedFields: [
            previous.stock_number !== next.stockNumber ? 'stockNumber' : null,
            previous.brand !== next.brand ? 'brand' : null,
            previous.model !== next.model ? 'model' : null,
            previous.remarks !== next.remarks ? 'remarks' : null,
            previous.features !== next.features ? 'features' : null,
          ].filter(Boolean),
        },
      });
    }

    await Promise.all(
      events.map((event) =>
        this.activityHistoryService.write(
          {
            actor: user,
            entityType: 'vehicle',
            entityId: previous.id,
            actionType: event.actionType,
            summary: event.summary,
            metadata: event.metadata,
          },
          trx,
        ),
      ),
    );
  }
}

interface WriteActivityEvent {
  actionType: string;
  summary: string;
  metadata: ActivityHistoryMetadata;
}
