import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import {
  buildPaginatedResponse,
  normalizeSearch,
  parsePagination,
} from '../../common/utils/list-query.utils';
import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import {
  mapVehicleResponse,
  parseVehicleStatus,
} from '../vehicles/vehicles.helpers';
import { ConvertSellerLeadDto } from './dto/convert-seller-lead.dto';
import { CreateSellerLeadDto } from './dto/create-seller-lead.dto';
import { ListSellerLeadsQueryDto } from './dto/list-seller-leads-query.dto';
import { SellerLeadEstimatedCostDto } from './dto/seller-lead-estimated-cost.dto';
import { UpdateSellerLeadDto } from './dto/update-seller-lead.dto';
import {
  calculateSellerLeadEvaluationSummary,
  mapSellerLeadEstimatedCostResponse,
  mapSellerLeadResponse,
  normalizeOptionalMoney,
  normalizeSellerLeadEstimatedCostAmount,
  normalizeSellerLeadEstimatedCostNote,
  parseInspectionFindings,
  parseOptionalIsoDate,
  parseSellerLeadDecision,
  parseSellerLeadEstimatedCostCategory,
  parseSellerLeadStatus,
} from './seller-leads.helpers';

@Injectable()
export class SellerLeadsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly vehiclesService: VehiclesService,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async create(user: CurrentUser, createSellerLeadDto: CreateSellerLeadDto) {
    const sellerLead = await this.db
      .insertInto('crm.seller_leads')
      .values({
        seller_name: this.requireNonEmpty(
          createSellerLeadDto.sellerName,
          'sellerName',
        ),
        contact_number: this.requireNonEmpty(
          createSellerLeadDto.contactNumber,
          'contactNumber',
        ),
        email: createSellerLeadDto.email ?? null,
        facebook_name: createSellerLeadDto.facebookName ?? null,
        inquiry_source: createSellerLeadDto.inquirySource ?? null,
        vehicle_brand: this.requireNonEmpty(
          createSellerLeadDto.vehicleBrand,
          'vehicleBrand',
        ),
        vehicle_model: this.requireNonEmpty(
          createSellerLeadDto.vehicleModel,
          'vehicleModel',
        ),
        vehicle_year: createSellerLeadDto.vehicleYear ?? null,
        vehicle_variant: createSellerLeadDto.vehicleVariant ?? null,
        asking_price: normalizeOptionalMoney(createSellerLeadDto.askingPrice),
        region: createSellerLeadDto.region ?? null,
        notes: createSellerLeadDto.notes ?? null,
        inspection_completed_at: parseOptionalIsoDate(
          createSellerLeadDto.inspectionCompletedAt,
        ),
        inspection_notes: createSellerLeadDto.inspectionNotes ?? null,
        inspection_findings: parseInspectionFindings(
          createSellerLeadDto.inspectionFindings,
        ),
        target_buy_price: normalizeOptionalMoney(createSellerLeadDto.targetBuyPrice),
        expected_resale_price: normalizeOptionalMoney(
          createSellerLeadDto.expectedResalePrice,
        ),
        target_profit_amount: normalizeOptionalMoney(
          createSellerLeadDto.targetProfitAmount,
        ),
        decision: parseSellerLeadDecision(createSellerLeadDto.decision),
        decision_note: createSellerLeadDto.decisionNote ?? null,
        status: parseSellerLeadStatus(
          createSellerLeadDto.status,
          'New Inquiry',
        ),
        assignee_user_id: createSellerLeadDto.assigneeUserId ?? null,
        closing_note: createSellerLeadDto.closingNote ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'seller_lead',
      entityId: sellerLead.id,
      actionType: 'seller_lead.created',
      summary: 'Seller lead created',
      metadata: {
        sellerName: sellerLead.seller_name,
        vehicleBrand: sellerLead.vehicle_brand,
        vehicleModel: sellerLead.vehicle_model,
        status: sellerLead.status,
      },
    });

    return {
      sellerLead: await this.buildSellerLeadResponse({
        ...sellerLead,
        status: parseSellerLeadStatus(sellerLead.status, 'New Inquiry'),
      }),
    };
  }

  async findAll(query: ListSellerLeadsQueryDto = {}) {
    const pagination = parsePagination(query);
    const search = normalizeSearch(query.search);
    const status = query.status
      ? parseSellerLeadStatus(query.status, 'New Inquiry')
      : undefined;
    const sort = this.parseSort(query.sortBy, query.sortOrder);

    let sellerLeadsQuery = this.db.selectFrom('crm.seller_leads');

    if (status) {
      sellerLeadsQuery = sellerLeadsQuery.where('status', '=', status);
    }

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      sellerLeadsQuery = sellerLeadsQuery.where(({ eb, or }) =>
        or([
          eb(sql<string>`lower(seller_name)`, 'like', pattern),
          eb(sql<string>`lower(contact_number)`, 'like', pattern),
          eb(sql<string>`lower(vehicle_brand)`, 'like', pattern),
          eb(sql<string>`lower(vehicle_model)`, 'like', pattern),
          eb(
            sql<string>`lower(coalesce(vehicle_variant, ''))`,
            'like',
            pattern,
          ),
          eb(sql<string>`coalesce(vehicle_year::text, '')`, 'like', pattern),
        ]),
      );
    }

    const totalRow = await sellerLeadsQuery
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);

    const sellerLeads = await sellerLeadsQuery
      .selectAll()
      .orderBy(sort.column, sort.direction)
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const response = buildPaginatedResponse(
      await Promise.all(
        sellerLeads.map((lead) =>
          this.buildSellerLeadResponse({
            ...lead,
            status: parseSellerLeadStatus(lead.status, 'New Inquiry'),
          }),
        ),
      ),
      pagination,
      total,
    );

    return {
      sellerLeads: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async findOne(id: string) {
    const sellerLead = await this.getLeadRecordOrThrow(id);
    return { sellerLead: await this.buildSellerLeadResponse(sellerLead) };
  }

  async update(
    id: string,
    updateSellerLeadDto: UpdateSellerLeadDto,
    currentUser: CurrentUser,
  ) {
    const existingLead = await this.getLeadRecordOrThrow(id);
    const nextStatus =
      updateSellerLeadDto.status !== undefined
        ? parseSellerLeadStatus(updateSellerLeadDto.status, existingLead.status)
        : existingLead.status;

    if (existingLead.status === 'Rejected' && nextStatus === 'Approved to Buy') {
      throw new BadRequestException('Rejected seller leads cannot be approved');
    }

    const nextAssigneeUserId =
      updateSellerLeadDto.assigneeUserId !== undefined
        ? updateSellerLeadDto.assigneeUserId ?? null
        : existingLead.assignee_user_id;

    await this.db
      .updateTable('crm.seller_leads')
      .set({
        ...(updateSellerLeadDto.sellerName !== undefined
          ? {
              seller_name: this.requireNonEmpty(
                updateSellerLeadDto.sellerName,
                'sellerName',
              ),
            }
          : {}),
        ...(updateSellerLeadDto.contactNumber !== undefined
          ? {
              contact_number: this.requireNonEmpty(
                updateSellerLeadDto.contactNumber,
                'contactNumber',
              ),
            }
          : {}),
        ...(updateSellerLeadDto.email !== undefined
          ? { email: updateSellerLeadDto.email ?? null }
          : {}),
        ...(updateSellerLeadDto.facebookName !== undefined
          ? { facebook_name: updateSellerLeadDto.facebookName ?? null }
          : {}),
        ...(updateSellerLeadDto.inquirySource !== undefined
          ? { inquiry_source: updateSellerLeadDto.inquirySource ?? null }
          : {}),
        ...(updateSellerLeadDto.vehicleBrand !== undefined
          ? {
              vehicle_brand: this.requireNonEmpty(
                updateSellerLeadDto.vehicleBrand,
                'vehicleBrand',
              ),
            }
          : {}),
        ...(updateSellerLeadDto.vehicleModel !== undefined
          ? {
              vehicle_model: this.requireNonEmpty(
                updateSellerLeadDto.vehicleModel,
                'vehicleModel',
              ),
            }
          : {}),
        ...(updateSellerLeadDto.vehicleYear !== undefined
          ? { vehicle_year: updateSellerLeadDto.vehicleYear ?? null }
          : {}),
        ...(updateSellerLeadDto.vehicleVariant !== undefined
          ? { vehicle_variant: updateSellerLeadDto.vehicleVariant ?? null }
          : {}),
        ...(updateSellerLeadDto.askingPrice !== undefined
          ? { asking_price: normalizeOptionalMoney(updateSellerLeadDto.askingPrice) }
          : {}),
        ...(updateSellerLeadDto.region !== undefined
          ? { region: updateSellerLeadDto.region ?? null }
          : {}),
        ...(updateSellerLeadDto.notes !== undefined
          ? { notes: updateSellerLeadDto.notes ?? null }
          : {}),
        ...(updateSellerLeadDto.inspectionCompletedAt !== undefined
          ? {
              inspection_completed_at: parseOptionalIsoDate(
                updateSellerLeadDto.inspectionCompletedAt,
              ),
            }
          : {}),
        ...(updateSellerLeadDto.inspectionNotes !== undefined
          ? { inspection_notes: updateSellerLeadDto.inspectionNotes ?? null }
          : {}),
        ...(updateSellerLeadDto.inspectionFindings !== undefined
          ? {
              inspection_findings: parseInspectionFindings(
                updateSellerLeadDto.inspectionFindings,
              ),
            }
          : {}),
        ...(updateSellerLeadDto.targetBuyPrice !== undefined
          ? {
              target_buy_price: normalizeOptionalMoney(
                updateSellerLeadDto.targetBuyPrice,
              ),
            }
          : {}),
        ...(updateSellerLeadDto.expectedResalePrice !== undefined
          ? {
              expected_resale_price: normalizeOptionalMoney(
                updateSellerLeadDto.expectedResalePrice,
              ),
            }
          : {}),
        ...(updateSellerLeadDto.targetProfitAmount !== undefined
          ? {
              target_profit_amount: normalizeOptionalMoney(
                updateSellerLeadDto.targetProfitAmount,
              ),
            }
          : {}),
        ...(updateSellerLeadDto.decision !== undefined
          ? { decision: parseSellerLeadDecision(updateSellerLeadDto.decision) }
          : {}),
        ...(updateSellerLeadDto.decisionNote !== undefined
          ? { decision_note: updateSellerLeadDto.decisionNote ?? null }
          : {}),
        ...(updateSellerLeadDto.status !== undefined ? { status: nextStatus } : {}),
        ...(updateSellerLeadDto.status === 'Approved to Buy'
          ? {
              approved_to_buy_at: new Date(),
              approved_by_user_id: currentUser.id,
            }
          : {}),
        ...(updateSellerLeadDto.status !== undefined &&
        updateSellerLeadDto.status !== 'Approved to Buy' &&
        existingLead.status === 'Approved to Buy'
          ? {
              approved_to_buy_at: null,
              approved_by_user_id: null,
            }
          : {}),
        ...(updateSellerLeadDto.assigneeUserId !== undefined
          ? { assignee_user_id: nextAssigneeUserId }
          : {}),
        ...(updateSellerLeadDto.closingNote !== undefined
          ? { closing_note: updateSellerLeadDto.closingNote ?? null }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    await this.writeUpdateActivity(currentUser, existingLead, {
      status: nextStatus,
      assignee_user_id: nextAssigneeUserId,
      seller_name:
        updateSellerLeadDto.sellerName !== undefined
          ? this.requireNonEmpty(updateSellerLeadDto.sellerName, 'sellerName')
          : existingLead.seller_name,
      vehicle_brand:
        updateSellerLeadDto.vehicleBrand !== undefined
          ? this.requireNonEmpty(updateSellerLeadDto.vehicleBrand, 'vehicleBrand')
          : existingLead.vehicle_brand,
      vehicle_model:
        updateSellerLeadDto.vehicleModel !== undefined
          ? this.requireNonEmpty(updateSellerLeadDto.vehicleModel, 'vehicleModel')
          : existingLead.vehicle_model,
      asking_price:
        updateSellerLeadDto.askingPrice !== undefined
          ? updateSellerLeadDto.askingPrice ?? null
          : existingLead.asking_price,
      notes: updateSellerLeadDto.notes !== undefined ? updateSellerLeadDto.notes ?? null : existingLead.notes,
    });

    const sellerLead = await this.getLeadRecordOrThrow(id);
    return { sellerLead: await this.buildSellerLeadResponse(sellerLead) };
  }

  async createEstimatedCost(id: string, dto: SellerLeadEstimatedCostDto) {
    await this.getLeadRecordOrThrow(id);

    await this.db
      .insertInto('crm.seller_lead_estimated_costs')
      .values({
        seller_lead_id: id,
        category: parseSellerLeadEstimatedCostCategory(dto.category),
        amount: normalizeSellerLeadEstimatedCostAmount(dto.amount),
        note: normalizeSellerLeadEstimatedCostNote(dto.note),
      })
      .executeTakeFirstOrThrow();

    const sellerLead = await this.getLeadRecordOrThrow(id);
    return { sellerLead: await this.buildSellerLeadResponse(sellerLead) };
  }

  async deleteEstimatedCost(id: string, costId: string) {
    await this.getLeadRecordOrThrow(id);
    await this.getEstimatedCostOrThrow(id, costId);

    await this.db
      .deleteFrom('crm.seller_lead_estimated_costs')
      .where('id', '=', costId)
      .where('seller_lead_id', '=', id)
      .execute();

    const sellerLead = await this.getLeadRecordOrThrow(id);
    return { sellerLead: await this.buildSellerLeadResponse(sellerLead) };
  }

  async convert(user: CurrentUser, id: string, convertSellerLeadDto: ConvertSellerLeadDto) {
    return this.db.transaction().execute(async (trx) => {
      const sellerLead = await this.getLeadRecordOrThrow(id, trx);

      const existingVehicle = await trx
        .selectFrom('inventory.vehicles')
        .select(['id'])
        .where('seller_lead_id', '=', id)
        .executeTakeFirst();

      if (existingVehicle) {
        throw new BadRequestException(
          'Seller lead has already been converted into a vehicle',
        );
      }

      if (sellerLead.status === 'Rejected') {
        throw new BadRequestException(
          'Rejected seller leads cannot be converted',
        );
      }

      if (sellerLead.status === 'Purchased') {
        throw new BadRequestException(
          'Purchased seller leads cannot be converted again',
        );
      }

      if (sellerLead.status !== 'Approved to Buy') {
        throw new BadRequestException(
          'Seller lead must be approved to buy before conversion',
        );
      }

      const vehicleModel = this.vehiclesService.buildVehicleCreateModel({
        brand: sellerLead.vehicle_brand,
        model: sellerLead.vehicle_model,
        year: convertSellerLeadDto.year ?? sellerLead.vehicle_year ?? undefined,
        variant: convertSellerLeadDto.variant ?? sellerLead.vehicle_variant,
        mileage: convertSellerLeadDto.mileage,
        transmission: convertSellerLeadDto.transmission,
        fuelType: convertSellerLeadDto.fuelType,
        color: convertSellerLeadDto.color,
        region: convertSellerLeadDto.region ?? sellerLead.region,
        features: convertSellerLeadDto.features,
        remarks: convertSellerLeadDto.remarks,
        purchasePrice:
          convertSellerLeadDto.purchasePrice ??
          sellerLead.target_buy_price ??
          sellerLead.asking_price,
        targetSellingPrice: convertSellerLeadDto.targetSellingPrice,
        minimumAcceptablePrice: convertSellerLeadDto.minimumAcceptablePrice,
        acquisitionSource:
          convertSellerLeadDto.acquisitionSource ?? sellerLead.inquiry_source,
        sellerLeadId: sellerLead.id,
        status: convertSellerLeadDto.status ?? 'Incoming',
        photos: convertSellerLeadDto.photos,
      });
      const stockNumber = await this.vehiclesService.allocateStockNumber(
        trx as any,
      );

      const insertedVehicle = await trx
        .insertInto('inventory.vehicles')
        .values({
          stock_number: stockNumber,
          brand: vehicleModel.brand,
          model: vehicleModel.model,
          year: vehicleModel.year,
          variant: vehicleModel.variant,
          mileage: vehicleModel.mileage,
          transmission: vehicleModel.transmission,
          fuel_type: vehicleModel.fuelType,
          color: vehicleModel.color,
          region: vehicleModel.region,
          features: vehicleModel.features,
          remarks: vehicleModel.remarks,
          purchase_price: vehicleModel.purchasePrice,
          target_selling_price: vehicleModel.targetSellingPrice,
          minimum_acceptable_price: vehicleModel.minimumAcceptablePrice,
          acquisition_source: vehicleModel.acquisitionSource,
          seller_lead_id: sellerLead.id,
          status: vehicleModel.status,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      if (vehicleModel.photos.length > 0) {
        await trx
          .insertInto('inventory.vehicle_photos')
          .values(
            vehicleModel.photos.map((photo) => ({
              vehicle_id: insertedVehicle.id,
              file_url: photo.fileUrl,
              sort_order: photo.sortOrder ?? 0,
            })),
          )
          .execute();
      }

      await trx
        .updateTable('crm.seller_leads')
        .set({
          status: 'Purchased',
          latest_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'seller_lead',
          entityId: id,
          actionType: 'seller_lead.converted_to_vehicle',
          summary: 'Seller lead converted into a vehicle record',
          metadata: {
            vehicleId: insertedVehicle.id,
            nextStatus: 'Purchased',
          },
        },
        trx,
      );

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'vehicle',
          entityId: insertedVehicle.id,
          actionType: 'vehicle.created_from_seller_lead',
          summary: 'Vehicle created from seller lead conversion',
          metadata: {
            sellerLeadId: id,
            stockNumber,
            status: vehicleModel.status,
          },
        },
        trx,
      );

      const updatedLead = await this.getLeadRecordOrThrow(id, trx);
      const persistedVehicle = await trx
        .selectFrom('inventory.vehicles')
        .selectAll()
        .where('id', '=', insertedVehicle.id)
        .executeTakeFirstOrThrow();

      const persistedPhotos = await trx
        .selectFrom('inventory.vehicle_photos')
        .select(['file_url', 'sort_order'])
        .where('vehicle_id', '=', insertedVehicle.id)
        .orderBy('sort_order', 'asc')
        .execute();

      return {
        sellerLead: await this.buildSellerLeadResponse(updatedLead, trx),
        vehicle: mapVehicleResponse({
          ...persistedVehicle,
          status: parseVehicleStatus(persistedVehicle.status, 'Incoming'),
          photos: persistedPhotos.map((photo) => ({
            fileUrl: photo.file_url,
            sortOrder: photo.sort_order,
          })),
          trackedCosts: [],
          trackedCostsTotal: '0.00',
        }),
      };
    });
  }

  private async buildSellerLeadResponse(
    sellerLead: Awaited<ReturnType<typeof this.getLeadRecordOrThrow>>,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const estimatedCosts = await this.getEstimatedCosts(sellerLead.id, executor);
    const summary = calculateSellerLeadEvaluationSummary({
      askingPrice: sellerLead.asking_price,
      targetBuyPrice: sellerLead.target_buy_price,
      expectedResalePrice: sellerLead.expected_resale_price,
      targetProfitAmount: sellerLead.target_profit_amount,
      estimatedCosts,
    });

    return mapSellerLeadResponse({
      ...sellerLead,
      estimatedCosts: estimatedCosts.map(mapSellerLeadEstimatedCostResponse),
      ...summary,
    });
  }

  private async writeUpdateActivity(
    user: CurrentUser,
    previous: Awaited<ReturnType<SellerLeadsService['getLeadRecordOrThrow']>>,
    next: {
      status: string;
      assignee_user_id: string | null;
      seller_name: string;
      vehicle_brand: string;
      vehicle_model: string;
      asking_price: string | null;
      notes: string | null;
    },
  ) {
    const events: Promise<void>[] = [];

    if (previous.status !== next.status) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'seller_lead',
          entityId: previous.id,
          actionType: 'seller_lead.status_changed',
          summary: `Seller lead moved from ${previous.status} to ${next.status}`,
          metadata: { from: previous.status, to: next.status },
        }),
      );
    }

    if (previous.assignee_user_id !== next.assignee_user_id) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'seller_lead',
          entityId: previous.id,
          actionType: 'seller_lead.assignment_changed',
          summary: next.assignee_user_id ? 'Seller lead assignment changed' : 'Seller lead unassigned',
          metadata: { from: previous.assignee_user_id, to: next.assignee_user_id },
        }),
      );
    }

    if (
      previous.seller_name !== next.seller_name ||
      previous.vehicle_brand !== next.vehicle_brand ||
      previous.vehicle_model !== next.vehicle_model ||
      previous.asking_price !== next.asking_price ||
      previous.notes !== next.notes
    ) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'seller_lead',
          entityId: previous.id,
          actionType: 'seller_lead.details_updated',
          summary: 'Seller lead details updated',
          metadata: {
            changedFields: [
              previous.seller_name !== next.seller_name ? 'sellerName' : null,
              previous.vehicle_brand !== next.vehicle_brand ? 'vehicleBrand' : null,
              previous.vehicle_model !== next.vehicle_model ? 'vehicleModel' : null,
              previous.asking_price !== next.asking_price ? 'askingPrice' : null,
              previous.notes !== next.notes ? 'notes' : null,
            ].filter(Boolean),
          },
        }),
      );
    }

    await Promise.all(events);
  }

  private async getLeadRecordOrThrow(
    id: string,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const db = executor ?? this.db;
    const sellerLead = await db
      .selectFrom('crm.seller_leads')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!sellerLead) {
      throw new NotFoundException(`Seller lead ${id} was not found`);
    }

    return {
      ...sellerLead,
      status: parseSellerLeadStatus(sellerLead.status, 'New Inquiry'),
      decision: parseSellerLeadDecision(sellerLead.decision),
    };
  }

  private async getEstimatedCosts(
    sellerLeadId: string,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const db = executor ?? this.db;
    return db
      .selectFrom('crm.seller_lead_estimated_costs')
      .selectAll()
      .where('seller_lead_id', '=', sellerLeadId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  private async getEstimatedCostOrThrow(sellerLeadId: string, costId: string) {
    const estimatedCost = await this.db
      .selectFrom('crm.seller_lead_estimated_costs')
      .selectAll()
      .where('id', '=', costId)
      .where('seller_lead_id', '=', sellerLeadId)
      .executeTakeFirst();

    if (!estimatedCost) {
      throw new NotFoundException(
        `Estimated cost ${costId} was not found for seller lead ${sellerLeadId}`,
      );
    }

    return estimatedCost;
  }

  private requireNonEmpty(value: string, field: string) {
    const trimmed = value?.trim();

    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }

    return trimmed;
  }

  private parseSort(sortBy?: string, sortOrder?: string) {
    const direction = this.parseSortOrder(sortOrder);

    switch (sortBy) {
      case undefined:
      case 'updatedAt':
        return { column: 'updated_at' as const, direction };
      case 'createdAt':
        return { column: 'created_at' as const, direction };
      case 'sellerName':
        return { column: 'seller_name' as const, direction };
      case 'status':
        return { column: 'status' as const, direction };
      default:
        throw new BadRequestException(
          `Unsupported seller lead sort: ${sortBy}`,
        );
    }
  }

  private parseSortOrder(sortOrder?: string): 'asc' | 'desc' {
    if (!sortOrder || sortOrder === 'desc') {
      return 'desc';
    }

    if (sortOrder === 'asc') {
      return 'asc';
    }

    throw new BadRequestException(`Unsupported sort order: ${sortOrder}`);
  }
}
