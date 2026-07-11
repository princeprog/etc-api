import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, SelectQueryBuilder, Transaction } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import {
  buildPaginatedResponse,
  normalizeSearch,
  parsePagination,
} from '../../common/utils/list-query.utils';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { CreateSaleDraftDto } from './dto/create-sale-draft.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { UpdateSaleDraftDto } from './dto/update-sale-draft.dto';
import {
  calculateProfitAfterTrackedCosts,
  centsToMoney,
  formatSaleNumber,
  getDefaultCommissionAmount,
  getSaleNumberYear,
  mapCommissionResponse,
  mapSaleResponse,
  normalizeOptionalTrimmed,
  parseIsoDate,
  parseMoneyToCents,
  requireTrimmed,
} from './sales.helpers';
import { sql } from 'kysely';

type FinalizeSaleInput = {
  vehicleId?: string | null;
  buyerLeadId?: string | null;
  saleDate?: string | null;
  finalSaleAmount?: string | null;
  agentName?: string | null;
  commissionOverrideAmount?: string | null;
  commissionOverrideReason?: string | null;
  buyerClosingNote?: string | null;
};

type SaleListRecord = {
  id: string;
  recordType: 'sale' | 'draft';
  sortDate: Date;
};

@Injectable()
export class SalesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly vehiclesService: VehiclesService,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async create(user: CurrentUser, dto: CreateSaleDto) {
    return this.finalizeSale(user, dto);
  }

  async saveDraft(user: CurrentUser, dto: CreateSaleDraftDto) {
    const values = await this.normalizeDraftValues(user, dto);
    const draft = await this.db.transaction().execute(async (trx) => {
      await this.validateDraftBuyerVehicle(values.buyerLeadId, values.vehicleId, trx);

      const existingDraft = await trx
        .selectFrom('sales.sale_drafts')
        .select(['id'])
        .where('created_by_user_id', '=', user.id)
        .where('buyer_lead_id', '=', values.buyerLeadId)
        .where('vehicle_id', '=', values.vehicleId)
        .executeTakeFirst();

      if (existingDraft) {
        return trx
          .updateTable('sales.sale_drafts')
          .set({
            ...this.getDraftUpdateValues(values),
            updated_at: new Date(),
          })
          .where('id', '=', existingDraft.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      return trx
        .insertInto('sales.sale_drafts')
        .values({
          draft_number: await this.allocateDraftNumber(trx),
          vehicle_id: values.vehicleId,
          buyer_lead_id: values.buyerLeadId,
          created_by_user_id: user.id,
          ...this.getDraftUpdateValues(values),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return { draft: await this.getDraftOrThrow(draft.id) };
  }

  async updateDraft(user: CurrentUser, id: string, dto: UpdateSaleDraftDto) {
    const existingDraft = await this.getDraftModelOrThrow(id);
    const values = await this.normalizeDraftValues(user, {
      vehicleId: dto.vehicleId ?? existingDraft.vehicle_id,
      buyerLeadId: dto.buyerLeadId ?? existingDraft.buyer_lead_id,
      saleDate:
        dto.saleDate !== undefined
          ? dto.saleDate
          : this.formatDateInput(existingDraft.sale_date),
      finalSaleAmount:
        dto.finalSaleAmount !== undefined
          ? dto.finalSaleAmount
          : existingDraft.final_sale_amount,
      agentName:
        dto.agentName !== undefined ? dto.agentName : existingDraft.agent_name,
      commissionOverrideAmount:
        dto.commissionOverrideAmount !== undefined
          ? dto.commissionOverrideAmount
          : existingDraft.commission_override_amount,
      commissionOverrideReason:
        dto.commissionOverrideReason !== undefined
          ? dto.commissionOverrideReason
          : existingDraft.commission_override_reason,
      buyerClosingNote:
        dto.buyerClosingNote !== undefined
          ? dto.buyerClosingNote
          : existingDraft.buyer_closing_note,
    });

    const updatedDraft = await this.db.transaction().execute(async (trx) => {
      await this.validateDraftBuyerVehicle(values.buyerLeadId, values.vehicleId, trx);

      return trx
        .updateTable('sales.sale_drafts')
        .set({
          vehicle_id: values.vehicleId,
          buyer_lead_id: values.buyerLeadId,
          ...this.getDraftUpdateValues(values),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return { draft: await this.getDraftOrThrow(updatedDraft.id) };
  }

  async deleteDraft(id: string) {
    const deletedDraft = await this.db
      .deleteFrom('sales.sale_drafts')
      .where('id', '=', id)
      .returning(['id'])
      .executeTakeFirst();

    if (!deletedDraft) {
      throw new NotFoundException(`Sale draft ${id} was not found`);
    }

    return { id };
  }

  async finalizeDraft(user: CurrentUser, id: string) {
    const draft = await this.getDraftModelOrThrow(id);

    return this.finalizeSale(
      user,
      {
        vehicleId: draft.vehicle_id,
        buyerLeadId: draft.buyer_lead_id,
        saleDate: this.formatDateInput(draft.sale_date),
        finalSaleAmount: draft.final_sale_amount,
        agentName: draft.agent_name,
        commissionOverrideAmount: draft.commission_override_amount,
        commissionOverrideReason: draft.commission_override_reason,
        buyerClosingNote: draft.buyer_closing_note,
      },
      id,
    );
  }

  async findAll(query: ListSalesQueryDto = {}) {
    const pagination = parsePagination(query);
    const records = await this.getSalesListRecords(query);
    const total = records.length;
    const paginatedRecords = records.slice(
      pagination.offset,
      pagination.offset + pagination.pageSize,
    );
    const saleIds = paginatedRecords
      .filter((record) => record.recordType === 'sale')
      .map((record) => record.id);
    const draftIds = paginatedRecords
      .filter((record) => record.recordType === 'draft')
      .map((record) => record.id);
    const sales = await this.getSalesOrThrow(saleIds);
    const drafts = await this.getDraftsOrThrow(draftIds);
    const saleById = new Map(sales.map((sale) => [sale.id, sale]));
    const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
    const items = paginatedRecords.map((record) => {
      if (record.recordType === 'sale') {
        const sale = saleById.get(record.id);

        if (!sale) {
          throw new NotFoundException(`Sale ${record.id} was not found`);
        }

        return sale;
      }

      const draft = draftById.get(record.id);

      if (!draft) {
        throw new NotFoundException(`Sale draft ${record.id} was not found`);
      }

      return draft;
    });

    const response = buildPaginatedResponse(items, pagination, total);

    return {
      sales: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async getSummary(query: ListSalesQueryDto = {}) {
    const finalizedQuery =
      query.status === 'draft'
        ? this.buildFilteredSalesQuery({ ...query, status: 'none' })
        : this.buildFilteredSalesQuery(query);
    const summary = await finalizedQuery
      .select(({ fn }) => [
        fn.countAll<number>().as('totalSales'),
        sql<string>`coalesce(sum(sales.sales.final_sale_amount::numeric), 0)::text`.as(
          'totalRevenue',
        ),
        sql<string>`coalesce(sum(coalesce(sales.sales.gross_profit_amount, '0.00')::numeric), 0)::text`.as(
          'totalGrossProfit',
        ),
        sql<string>`coalesce(sum(sales.commissions.final_amount::numeric), 0)::text`.as(
          'totalCommissionPayouts',
        ),
        sql<string>`coalesce(sum(
          coalesce(sales.sales.gross_profit_amount, '0.00')::numeric -
          coalesce((
            select sum(cost.amount)
            from inventory.vehicle_tracked_costs as cost
            where cost.vehicle_id = sales.sales.vehicle_id
          ), 0)
        ), 0)::text`.as('totalProfitAfterTrackedCosts'),
      ])
      .executeTakeFirstOrThrow();
    const totalDrafts = await this.countDrafts(query);

    return {
      totalSales: Number(summary.totalSales),
      totalRevenue: this.normalizeSummaryMoney(summary.totalRevenue),
      totalGrossProfit: this.normalizeSummaryMoney(summary.totalGrossProfit),
      totalCommissionPayouts: this.normalizeSummaryMoney(
        summary.totalCommissionPayouts,
      ),
      totalProfitAfterTrackedCosts: this.normalizeSummaryMoney(
        summary.totalProfitAfterTrackedCosts,
      ),
      totalDrafts,
    };
  }

  async findOne(id: string) {
    return {
      sale: await this.getSaleOrThrow(id),
    };
  }

  private async finalizeSale(
    user: CurrentUser,
    input: FinalizeSaleInput,
    draftIdToDelete?: string,
  ) {
    const vehicleId = requireTrimmed(input.vehicleId, 'vehicleId');
    const buyerLeadId = requireTrimmed(input.buyerLeadId, 'buyerLeadId');
    const saleDate = parseIsoDate(input.saleDate ?? undefined, 'saleDate');
    const finalSaleAmount = requireTrimmed(
      input.finalSaleAmount,
      'finalSaleAmount',
    );
    const finalSaleAmountCents = parseMoneyToCents(
      input.finalSaleAmount,
      'finalSaleAmount',
    );
    const agentName = normalizeOptionalTrimmed(input.agentName);
    const overrideAmount = normalizeOptionalTrimmed(
      input.commissionOverrideAmount,
    );
    const overrideReason = normalizeOptionalTrimmed(
      input.commissionOverrideReason,
    );
    const buyerClosingNote = normalizeOptionalTrimmed(input.buyerClosingNote);

    if (overrideAmount && !overrideReason) {
      throw new BadRequestException(
        'commissionOverrideReason is required when commissionOverrideAmount is provided',
      );
    }

    const result = await this.db.transaction().execute(async (trx) => {
      const vehicle = await this.getVehicleOrThrow(vehicleId, trx);
      const buyerLead = await this.getBuyerLeadOrThrow(buyerLeadId, trx);

      if (vehicle.status === 'Sold') {
        throw new BadRequestException('Vehicle is already sold');
      }

      if (buyerLead.status === 'Won') {
        throw new BadRequestException(
          'Buyer lead is already won and cannot be used for a new sale',
        );
      }

      const existingSale = await trx
        .selectFrom('sales.sales')
        .select(['id'])
        .where('vehicle_id', '=', vehicleId)
        .executeTakeFirst();

      if (existingSale) {
        throw new BadRequestException(
          'Vehicle already has a finalized sale record',
        );
      }

      const link = await trx
        .selectFrom('crm.lead_vehicle_links')
        .select(['id'])
        .where('buyer_lead_id', '=', buyerLeadId)
        .where('vehicle_id', '=', vehicleId)
        .executeTakeFirst();

      if (!link) {
        throw new BadRequestException(
          'Buyer lead must be linked to the vehicle before finalizing a sale',
        );
      }

      const closingNote = buyerClosingNote ?? buyerLead.closing_note;

      if (!closingNote?.trim()) {
        throw new BadRequestException(
          'buyerClosingNote is required when the buyer lead does not already have a closing note',
        );
      }

      const grossProfitAmount =
        vehicle.purchase_price === null
          ? null
          : centsToMoney(
              finalSaleAmountCents -
                parseMoneyToCents(
                  vehicle.purchase_price,
                  'vehicle.purchasePrice',
                ),
            );

      const saleNumber = await this.allocateSaleNumber(trx, saleDate);

      const defaultCommissionAmount = agentName
        ? getDefaultCommissionAmount()
        : null;
      const finalCommissionAmount = agentName
        ? (overrideAmount ?? defaultCommissionAmount ?? '0.00')
        : '0.00';

      const insertedSale = await trx
        .insertInto('sales.sales')
        .values({
          sale_number: saleNumber,
          vehicle_id: vehicleId,
          buyer_lead_id: buyerLeadId,
          created_by_user_id: user.id,
          agent_name: agentName,
          sale_date: saleDate,
          final_sale_amount: finalSaleAmount,
          gross_profit_amount: grossProfitAmount,
          commission_method: agentName ? 'fixed' : null,
          commission_locked: true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const insertedCommission = await trx
        .insertInto('sales.commissions')
        .values({
          sale_id: insertedSale.id,
          agent_name: agentName,
          default_amount: defaultCommissionAmount,
          override_amount: overrideAmount,
          final_amount: finalCommissionAmount,
          override_reason: overrideReason,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('inventory.vehicles')
        .set({
          status: 'Sold',
          updated_at: new Date(),
        })
        .where('id', '=', vehicleId)
        .execute();

      await trx
        .updateTable('crm.buyer_leads')
        .set({
          status: 'Won',
          closing_note: closingNote,
          latest_activity_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', buyerLeadId)
        .execute();

      if (draftIdToDelete) {
        await trx
          .deleteFrom('sales.sale_drafts')
          .where('id', '=', draftIdToDelete)
          .execute();
      }

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'sale',
          entityId: insertedSale.id,
          actionType: 'sale.finalized',
          summary: `Sale ${saleNumber} finalized`,
          metadata: {
            vehicleId,
            buyerLeadId,
            saleNumber,
            finalSaleAmount,
          },
        },
        trx,
      );

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'vehicle',
          entityId: vehicleId,
          actionType: 'vehicle.sold',
          summary: `Vehicle marked sold through sale ${saleNumber}`,
          metadata: {
            saleId: insertedSale.id,
            saleNumber,
            finalSaleAmount,
          },
        },
        trx,
      );

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'buyer_lead',
          entityId: buyerLeadId,
          actionType: 'buyer_lead.sale_finalized',
          summary: `Buyer lead won through sale ${saleNumber}`,
          metadata: {
            saleId: insertedSale.id,
            saleNumber,
            vehicleId,
          },
        },
        trx,
      );

      if (overrideAmount) {
        await this.activityHistoryService.write(
          {
            actor: user,
            entityType: 'sale',
            entityId: insertedSale.id,
            actionType: 'sale.commission_override_used',
            summary: 'Commission override applied to finalized sale',
            metadata: {
              overrideAmount,
              overrideReason,
            },
          },
          trx,
        );
      }

      return {
        sale: insertedSale,
        commission: insertedCommission,
      };
    });

    const vehicle = (await this.vehiclesService.findOne(vehicleId)).vehicle;

    return {
      sale: this.mapSaleProfitability(
        mapSaleResponse(result.sale),
        vehicle.trackedCostsTotal,
      ),
      commission: mapCommissionResponse(result.commission),
      vehicle,
    };
  }

  private async getSaleOrThrow(id: string) {
    const sale = await this.db
      .selectFrom('sales.sales')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!sale) {
      throw new NotFoundException(`Sale ${id} was not found`);
    }

    const commission = await this.db
      .selectFrom('sales.commissions')
      .selectAll()
      .where('sale_id', '=', id)
      .executeTakeFirstOrThrow();

    const buyerLead = await this.db
      .selectFrom('crm.buyer_leads')
      .select([
        'id',
        'buyer_name',
        'contact_number',
        'email',
        'status',
        'closing_note',
      ])
      .where('id', '=', sale.buyer_lead_id)
      .executeTakeFirst();

    if (!buyerLead) {
      throw new NotFoundException(
        `Buyer lead ${sale.buyer_lead_id} was not found`,
      );
    }

    const vehicle = (await this.vehiclesService.findOne(sale.vehicle_id))
      .vehicle;

    return {
      recordType: 'sale' as const,
      status: this.getSaleStatus(commission),
      ...this.mapSaleProfitability(
        mapSaleResponse(sale),
        vehicle.trackedCostsTotal,
      ),
      buyerLead: {
        id: buyerLead.id,
        buyerName: buyerLead.buyer_name,
        contactNumber: buyerLead.contact_number,
        email: buyerLead.email,
        status: buyerLead.status,
        closingNote: buyerLead.closing_note,
      },
      commission: mapCommissionResponse(commission),
      vehicle,
    };
  }

  private async getSalesOrThrow(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    const sales = await this.db
      .selectFrom('sales.sales')
      .selectAll()
      .where('id', 'in', ids)
      .execute();

    const commissions = await this.db
      .selectFrom('sales.commissions')
      .selectAll()
      .where('sale_id', 'in', ids)
      .execute();

    const buyerLeadIds = sales.map((sale) => sale.buyer_lead_id);
    const buyerLeads = await this.db
      .selectFrom('crm.buyer_leads')
      .select([
        'id',
        'buyer_name',
        'contact_number',
        'email',
        'status',
        'closing_note',
      ])
      .where('id', 'in', buyerLeadIds)
      .execute();

    const vehicles = await Promise.all(
      sales.map((sale) => this.vehiclesService.findOne(sale.vehicle_id)),
    );
    const vehicleById = new Map(
      vehicles.map((vehicle) => [vehicle.vehicle.id, vehicle.vehicle]),
    );
    const commissionBySaleId = new Map(
      commissions.map((commission) => [commission.sale_id, commission]),
    );
    const buyerLeadById = new Map(
      buyerLeads.map((buyerLead) => [buyerLead.id, buyerLead]),
    );
    const salesById = new Map(sales.map((sale) => [sale.id, sale]));

    return ids.map((id) => {
      const sale = salesById.get(id);

      if (!sale) {
        throw new NotFoundException(`Sale ${id} was not found`);
      }

      const commission = commissionBySaleId.get(id);

      if (!commission) {
        throw new NotFoundException(`Commission for sale ${id} was not found`);
      }

      const vehicle = vehicleById.get(sale.vehicle_id);

      if (!vehicle) {
        throw new NotFoundException(`Vehicle ${sale.vehicle_id} was not found`);
      }

      const buyerLead = buyerLeadById.get(sale.buyer_lead_id);

      if (!buyerLead) {
        throw new NotFoundException(
          `Buyer lead ${sale.buyer_lead_id} was not found`,
        );
      }

      return {
        recordType: 'sale' as const,
        status: this.getSaleStatus(commission),
        ...this.mapSaleProfitability(
          mapSaleResponse(sale),
          vehicle.trackedCostsTotal,
        ),
        buyerLead: {
          id: buyerLead.id,
          buyerName: buyerLead.buyer_name,
          contactNumber: buyerLead.contact_number,
          email: buyerLead.email,
          status: buyerLead.status,
          closingNote: buyerLead.closing_note,
        },
        commission: mapCommissionResponse(commission),
        vehicle,
      };
    });
  }

  private async getDraftModelOrThrow(id: string) {
    const draft = await this.db
      .selectFrom('sales.sale_drafts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!draft) {
      throw new NotFoundException(`Sale draft ${id} was not found`);
    }

    return draft;
  }

  private async getDraftOrThrow(id: string) {
    const drafts = await this.getDraftsOrThrow([id]);
    const draft = drafts[0];

    if (!draft) {
      throw new NotFoundException(`Sale draft ${id} was not found`);
    }

    return draft;
  }

  private async getDraftsOrThrow(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    const drafts = await this.db
      .selectFrom('sales.sale_drafts')
      .selectAll()
      .where('id', 'in', ids)
      .execute();
    const buyerLeadIds = drafts.map((draft) => draft.buyer_lead_id);
    const buyerLeads = await this.db
      .selectFrom('crm.buyer_leads')
      .select([
        'id',
        'buyer_name',
        'contact_number',
        'email',
        'status',
        'closing_note',
      ])
      .where('id', 'in', buyerLeadIds)
      .execute();
    const vehicles = await Promise.all(
      drafts.map((draft) => this.vehiclesService.findOne(draft.vehicle_id)),
    );
    const vehicleById = new Map(
      vehicles.map((vehicle) => [vehicle.vehicle.id, vehicle.vehicle]),
    );
    const buyerLeadById = new Map(
      buyerLeads.map((buyerLead) => [buyerLead.id, buyerLead]),
    );
    const draftById = new Map(drafts.map((draft) => [draft.id, draft]));

    return ids.map((id) => {
      const draft = draftById.get(id);

      if (!draft) {
        throw new NotFoundException(`Sale draft ${id} was not found`);
      }

      const vehicle = vehicleById.get(draft.vehicle_id);

      if (!vehicle) {
        throw new NotFoundException(`Vehicle ${draft.vehicle_id} was not found`);
      }

      const buyerLead = buyerLeadById.get(draft.buyer_lead_id);

      if (!buyerLead) {
        throw new NotFoundException(
          `Buyer lead ${draft.buyer_lead_id} was not found`,
        );
      }

      return {
        id: draft.id,
        recordType: 'draft' as const,
        status: 'draft' as const,
        draftNumber: draft.draft_number,
        vehicleId: draft.vehicle_id,
        buyerLeadId: draft.buyer_lead_id,
        createdByUserId: draft.created_by_user_id,
        agentName: draft.agent_name,
        saleDate: draft.sale_date,
        finalSaleAmount: draft.final_sale_amount,
        commissionOverrideAmount: draft.commission_override_amount,
        commissionOverrideReason: draft.commission_override_reason,
        buyerClosingNote: draft.buyer_closing_note,
        createdAt: draft.created_at,
        updatedAt: draft.updated_at,
        buyerLead: {
          id: buyerLead.id,
          buyerName: buyerLead.buyer_name,
          contactNumber: buyerLead.contact_number,
          email: buyerLead.email,
          status: buyerLead.status,
          closingNote: buyerLead.closing_note,
        },
        vehicle,
      };
    });
  }

  private async getVehicleOrThrow(id: string, trx: Transaction<DB>) {
    const vehicle = await trx
      .selectFrom('inventory.vehicles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }

    return vehicle;
  }

  private mapSaleProfitability(
    sale: ReturnType<typeof mapSaleResponse>,
    trackedCostsTotal: string,
  ) {
    return {
      ...sale,
      trackedCostsTotal,
      profitAfterTrackedCosts: calculateProfitAfterTrackedCosts(
        sale.grossProfitAmount,
        trackedCostsTotal,
      ),
    };
  }

  private getSaleStatus(commission: { override_amount: string | null }) {
    return commission.override_amount ? 'commission_locked' : 'finalized';
  }

  private async normalizeDraftValues(
    user: CurrentUser,
    dto: CreateSaleDraftDto,
  ) {
    const vehicleId = requireTrimmed(dto.vehicleId, 'vehicleId');
    const buyerLeadId = requireTrimmed(dto.buyerLeadId, 'buyerLeadId');
    const saleDate = dto.saleDate?.trim()
      ? parseIsoDate(dto.saleDate, 'saleDate')
      : null;
    const finalSaleAmount = normalizeOptionalTrimmed(dto.finalSaleAmount);
    const commissionOverrideAmount = normalizeOptionalTrimmed(
      dto.commissionOverrideAmount,
    );

    if (finalSaleAmount) {
      parseMoneyToCents(finalSaleAmount, 'finalSaleAmount');
    }

    if (commissionOverrideAmount) {
      parseMoneyToCents(commissionOverrideAmount, 'commissionOverrideAmount');
    }

    return {
      vehicleId,
      buyerLeadId,
      createdByUserId: user.id,
      agentName: normalizeOptionalTrimmed(dto.agentName),
      saleDate,
      finalSaleAmount,
      commissionOverrideAmount,
      commissionOverrideReason: normalizeOptionalTrimmed(
        dto.commissionOverrideReason,
      ),
      buyerClosingNote: normalizeOptionalTrimmed(dto.buyerClosingNote),
    };
  }

  private getDraftUpdateValues(values: {
    agentName: string | null;
    saleDate: Date | null;
    finalSaleAmount: string | null;
    commissionOverrideAmount: string | null;
    commissionOverrideReason: string | null;
    buyerClosingNote: string | null;
  }) {
    return {
      agent_name: values.agentName,
      sale_date: values.saleDate,
      final_sale_amount: values.finalSaleAmount,
      commission_override_amount: values.commissionOverrideAmount,
      commission_override_reason: values.commissionOverrideReason,
      buyer_closing_note: values.buyerClosingNote,
    };
  }

  private async validateDraftBuyerVehicle(
    buyerLeadId: string,
    vehicleId: string,
    trx: Transaction<DB>,
  ) {
    await this.getVehicleOrThrow(vehicleId, trx);
    await this.getBuyerLeadOrThrow(buyerLeadId, trx);

    const link = await trx
      .selectFrom('crm.lead_vehicle_links')
      .select(['id'])
      .where('buyer_lead_id', '=', buyerLeadId)
      .where('vehicle_id', '=', vehicleId)
      .executeTakeFirst();

    if (!link) {
      throw new BadRequestException(
        'Buyer lead must be linked to the vehicle before saving a sale draft',
      );
    }
  }

  private formatDateInput(date: Date | null) {
    return date ? date.toISOString() : null;
  }

  private async getBuyerLeadOrThrow(id: string, trx: Transaction<DB>) {
    const buyerLead = await trx
      .selectFrom('crm.buyer_leads')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!buyerLead) {
      throw new NotFoundException(`Buyer lead ${id} was not found`);
    }

    return buyerLead;
  }

  private async getSalesListRecords(query: ListSalesQueryDto = {}) {
    const includeDrafts = !query.status || query.status === 'all' || query.status === 'draft';
    const includeSales = query.status !== 'draft';
    const records: SaleListRecord[] = [];

    if (includeSales) {
      const sales = await this.buildFilteredSalesQuery(query)
        .select([
          'sales.sales.id as id',
          'sales.sales.sale_date as saleDate',
          'sales.sales.created_at as createdAt',
        ])
        .execute();

      records.push(
        ...sales.map((sale) => ({
          id: sale.id,
          recordType: 'sale' as const,
          sortDate: sale.saleDate ?? sale.createdAt,
        })),
      );
    }

    if (includeDrafts) {
      const drafts = await this.buildFilteredDraftsQuery(query)
        .select([
          'sales.sale_drafts.id as id',
          'sales.sale_drafts.sale_date as saleDate',
          'sales.sale_drafts.updated_at as updatedAt',
          'sales.sale_drafts.created_at as createdAt',
        ])
        .execute();

      records.push(
        ...drafts.map((draft) => ({
          id: draft.id,
          recordType: 'draft' as const,
          sortDate: draft.saleDate ?? draft.updatedAt ?? draft.createdAt,
        })),
      );
    }

    records.sort((left, right) => this.compareListRecords(left, right, query));

    return records;
  }

  private compareListRecords(
    left: SaleListRecord,
    right: SaleListRecord,
    query: ListSalesQueryDto,
  ) {
    const direction = this.parseSortOrder(query.sortOrder);
    const multiplier = direction === 'asc' ? 1 : -1;

    return (
      (left.sortDate.getTime() - right.sortDate.getTime()) * multiplier ||
      left.id.localeCompare(right.id) * multiplier
    );
  }

  private async countDrafts(query: ListSalesQueryDto = {}) {
    if (query.status && query.status !== 'all' && query.status !== 'draft') {
      return 0;
    }

    const row = await this.buildFilteredDraftsQuery(query)
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  private buildFilteredSalesQuery(query: ListSalesQueryDto = {}) {
    const search = normalizeSearch(query.search);
    const agentName = normalizeOptionalTrimmed(query.agentName);

    let salesQuery = this.db
      .selectFrom('sales.sales')
      .innerJoin(
        'inventory.vehicles',
        'inventory.vehicles.id',
        'sales.sales.vehicle_id',
      )
      .innerJoin(
        'crm.buyer_leads',
        'crm.buyer_leads.id',
        'sales.sales.buyer_lead_id',
      )
      .innerJoin(
        'sales.commissions',
        'sales.commissions.sale_id',
        'sales.sales.id',
      );

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      salesQuery = salesQuery.where(({ eb, or }) =>
        or([
          eb(sql<string>`lower(sales.sales.sale_number)`, 'like', pattern),
          eb(sql<string>`lower(sales.sales.id::text)`, 'like', pattern),
          eb(
            sql<string>`lower(inventory.vehicles.stock_number)`,
            'like',
            pattern,
          ),
          eb(sql<string>`lower(inventory.vehicles.brand)`, 'like', pattern),
          eb(sql<string>`lower(inventory.vehicles.model)`, 'like', pattern),
          eb(
            sql<string>`lower(coalesce(sales.sales.agent_name, ''))`,
            'like',
            pattern,
          ),
          eb(sql<string>`lower(crm.buyer_leads.buyer_name)`, 'like', pattern),
          eb(
            sql<string>`lower(crm.buyer_leads.contact_number)`,
            'like',
            pattern,
          ),
        ]),
      );
    }

    if (agentName) {
      salesQuery = salesQuery.where(
        sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${agentName})`,
      );
    }

    if (query.status) {
      salesQuery = this.applyStatusFilter(salesQuery, query.status);
    }

    if (query.dateRange) {
      salesQuery = this.applyDateRangeFilter(salesQuery, query.dateRange);
    }

    return salesQuery;
  }

  private buildFilteredDraftsQuery(query: ListSalesQueryDto = {}) {
    const search = normalizeSearch(query.search);
    const agentName = normalizeOptionalTrimmed(query.agentName);

    let draftsQuery = this.db
      .selectFrom('sales.sale_drafts')
      .innerJoin(
        'inventory.vehicles',
        'inventory.vehicles.id',
        'sales.sale_drafts.vehicle_id',
      )
      .innerJoin(
        'crm.buyer_leads',
        'crm.buyer_leads.id',
        'sales.sale_drafts.buyer_lead_id',
      );

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      draftsQuery = draftsQuery.where(({ eb, or }) =>
        or([
          eb(
            sql<string>`lower(sales.sale_drafts.draft_number)`,
            'like',
            pattern,
          ),
          eb(sql<string>`lower(sales.sale_drafts.id::text)`, 'like', pattern),
          eb(
            sql<string>`lower(inventory.vehicles.stock_number)`,
            'like',
            pattern,
          ),
          eb(sql<string>`lower(inventory.vehicles.brand)`, 'like', pattern),
          eb(sql<string>`lower(inventory.vehicles.model)`, 'like', pattern),
          eb(
            sql<string>`lower(coalesce(sales.sale_drafts.agent_name, ''))`,
            'like',
            pattern,
          ),
          eb(sql<string>`lower(crm.buyer_leads.buyer_name)`, 'like', pattern),
          eb(
            sql<string>`lower(crm.buyer_leads.contact_number)`,
            'like',
            pattern,
          ),
        ]),
      );
    }

    if (agentName) {
      draftsQuery = draftsQuery.where(
        sql<boolean>`lower(coalesce(sales.sale_drafts.agent_name, '')) = lower(${agentName})`,
      );
    }

    if (query.dateRange) {
      draftsQuery = this.applyDraftDateRangeFilter(
        draftsQuery,
        query.dateRange,
      );
    }

    return draftsQuery;
  }

  private async allocateSaleNumber(trx: Transaction<DB>, saleDate: Date) {
    const saleYear = getSaleNumberYear(saleDate);

    await sql`select pg_advisory_xact_lock(${saleYear})`.execute(trx);

    const latestSaleForYear = await trx
      .selectFrom('sales.sales')
      .select(['sale_number'])
      .where(sql<boolean>`extract(year from sale_date) = ${saleYear}`)
      .orderBy(sql<number>`split_part(sale_number, '-', 3)::integer`, 'desc')
      .executeTakeFirst();

    if (!latestSaleForYear?.sale_number) {
      return formatSaleNumber(saleYear, 1);
    }

    const latestSequence = Number(
      latestSaleForYear.sale_number.split('-').at(-1) ?? '0',
    );
    return formatSaleNumber(saleYear, latestSequence + 1);
  }

  private async allocateDraftNumber(trx: Transaction<DB>) {
    const draftYear = new Date().getUTCFullYear();

    await sql`select pg_advisory_xact_lock(${draftYear + 100_000})`.execute(
      trx,
    );

    const latestDraftForYear = await trx
      .selectFrom('sales.sale_drafts')
      .select(['draft_number'])
      .where('draft_number', 'like', `D-${draftYear}-%`)
      .orderBy(sql<number>`split_part(draft_number, '-', 3)::integer`, 'desc')
      .executeTakeFirst();

    if (!latestDraftForYear?.draft_number) {
      return `D-${draftYear}-001`;
    }

    const latestSequence = Number(
      latestDraftForYear.draft_number.split('-').at(-1) ?? '0',
    );

    return `D-${draftYear}-${String(latestSequence + 1).padStart(3, '0')}`;
  }

  private applyStatusFilter(
    query: SelectQueryBuilder<
      DB,
      | 'sales.sales'
      | 'inventory.vehicles'
      | 'crm.buyer_leads'
      | 'sales.commissions',
      object
    >,
    status: string,
  ) {
    switch (status) {
      case 'all':
      case '':
        return query;
      case 'none':
        return query.where(sql<boolean>`false`);
      case 'finalized':
        return query
          .where('sales.sales.commission_locked', '=', true)
          .where('sales.commissions.override_amount', 'is', null);
      case 'commission_locked':
        return query
          .where('sales.sales.commission_locked', '=', true)
          .where('sales.commissions.override_amount', 'is not', null);
      case 'needs_review':
        return query.where('sales.sales.commission_locked', '=', false);
      default:
        throw new BadRequestException(`Unsupported sales status: ${status}`);
    }
  }

  private applyDraftDateRangeFilter(
    query: SelectQueryBuilder<
      DB,
      'sales.sale_drafts' | 'inventory.vehicles' | 'crm.buyer_leads',
      object
    >,
    dateRange: string,
  ) {
    const now = new Date();

    switch (dateRange) {
      case 'all':
      case '':
        return query;
      case 'this_month':
        return query.where(
          sql<boolean>`date_trunc('month', sales.sale_drafts.sale_date) = date_trunc('month', ${now}::timestamptz)`,
        );
      case 'last_30_days':
        return query.where(
          'sales.sale_drafts.sale_date',
          '>=',
          new Date(now.getTime() - 30 * 86_400_000),
        );
      default:
        throw new BadRequestException(
          `Unsupported sales date range: ${dateRange}`,
        );
    }
  }

  private applyDateRangeFilter(
    query: SelectQueryBuilder<
      DB,
      | 'sales.sales'
      | 'inventory.vehicles'
      | 'crm.buyer_leads'
      | 'sales.commissions',
      object
    >,
    dateRange: string,
  ) {
    const now = new Date();

    switch (dateRange) {
      case 'all':
      case '':
        return query;
      case 'this_month':
        return query.where(
          sql<boolean>`date_trunc('month', sales.sales.sale_date) = date_trunc('month', ${now}::timestamptz)`,
        );
      case 'last_30_days':
        return query.where(
          'sales.sales.sale_date',
          '>=',
          new Date(now.getTime() - 30 * 86_400_000),
        );
      default:
        throw new BadRequestException(
          `Unsupported sales date range: ${dateRange}`,
        );
    }
  }

  private parseSort(sortBy?: string, sortOrder?: string) {
    const direction = this.parseSortOrder(sortOrder);

    switch (sortBy) {
      case undefined:
      case 'saleDate':
        return { column: 'sales.sales.sale_date' as const, direction };
      case 'createdAt':
        return { column: 'sales.sales.created_at' as const, direction };
      case 'finalSaleAmount':
        return { column: 'sales.sales.final_sale_amount' as const, direction };
      case 'saleNumber':
        return { column: 'sales.sales.sale_number' as const, direction };
      case 'agentName':
        return { column: 'sales.sales.agent_name' as const, direction };
      default:
        throw new BadRequestException(`Unsupported sales sort: ${sortBy}`);
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

  private normalizeSummaryMoney(value: string) {
    const numericValue = Number(value);

    if (Number.isNaN(numericValue)) {
      return '0.00';
    }

    return numericValue.toFixed(2);
  }
}
