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
import { VehiclesService } from '../vehicles/vehicles.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import {
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

@Injectable()
export class SalesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly vehiclesService: VehiclesService,
  ) {}

  async create(user: CurrentUser, dto: CreateSaleDto) {
    const vehicleId = requireTrimmed(dto.vehicleId, 'vehicleId');
    const buyerLeadId = requireTrimmed(dto.buyerLeadId, 'buyerLeadId');
    const saleDate = parseIsoDate(dto.saleDate, 'saleDate');
    const finalSaleAmount = requireTrimmed(
      dto.finalSaleAmount,
      'finalSaleAmount',
    );
    const finalSaleAmountCents = parseMoneyToCents(
      dto.finalSaleAmount,
      'finalSaleAmount',
    );
    const agentName = normalizeOptionalTrimmed(dto.agentName);
    const overrideAmount = normalizeOptionalTrimmed(
      dto.commissionOverrideAmount,
    );
    const overrideReason = normalizeOptionalTrimmed(
      dto.commissionOverrideReason,
    );
    const buyerClosingNote = normalizeOptionalTrimmed(dto.buyerClosingNote);

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
        throw new BadRequestException('Buyer lead is already won and cannot be used for a new sale');
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

      return {
        sale: insertedSale,
        commission: insertedCommission,
      };
    });

    return {
      sale: mapSaleResponse(result.sale),
      commission: mapCommissionResponse(result.commission),
      vehicle: (await this.vehiclesService.findOne(vehicleId)).vehicle,
    };
  }

  async findAll(query: ListSalesQueryDto = {}) {
    const pagination = parsePagination(query);
    const sort = this.parseSort(query.sortBy, query.sortOrder);
    const salesQuery = this.buildFilteredSalesQuery(query);

    const totalRow = await salesQuery
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);

    const sales = await salesQuery
      .select('sales.sales.id as id')
      .orderBy(sort.column, sort.direction)
      .orderBy('sales.sales.created_at', 'desc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const response = buildPaginatedResponse(
      await this.getSalesOrThrow(sales.map((sale) => sale.id)),
      pagination,
      total,
    );

    return {
      sales: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async getSummary(query: ListSalesQueryDto = {}) {
    const summary = await this.buildFilteredSalesQuery(query)
      .select(({ fn }) => [
        fn.countAll<number>().as('totalSales'),
        sql<string>`coalesce(sum(sales.sales.final_sale_amount::numeric), 0)::text`.as('totalRevenue'),
        sql<string>`coalesce(sum(coalesce(sales.sales.gross_profit_amount, '0.00')::numeric), 0)::text`.as(
          'totalGrossProfit',
        ),
        sql<string>`coalesce(sum(sales.commissions.final_amount::numeric), 0)::text`.as(
          'totalCommissionPayouts',
        ),
      ])
      .executeTakeFirstOrThrow();

    return {
      totalSales: Number(summary.totalSales),
      totalRevenue: this.normalizeSummaryMoney(summary.totalRevenue),
      totalGrossProfit: this.normalizeSummaryMoney(summary.totalGrossProfit),
      totalCommissionPayouts: this.normalizeSummaryMoney(summary.totalCommissionPayouts),
    };
  }

  async findOne(id: string) {
    return {
      sale: await this.getSaleOrThrow(id),
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
      throw new NotFoundException(`Buyer lead ${sale.buyer_lead_id} was not found`);
    }

    return {
      ...mapSaleResponse(sale),
      buyerLead: {
        id: buyerLead.id,
        buyerName: buyerLead.buyer_name,
        contactNumber: buyerLead.contact_number,
        email: buyerLead.email,
        status: buyerLead.status,
        closingNote: buyerLead.closing_note,
      },
      commission: mapCommissionResponse(commission),
      vehicle: (await this.vehiclesService.findOne(sale.vehicle_id)).vehicle,
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

    const vehicles = await Promise.all(sales.map((sale) => this.vehiclesService.findOne(sale.vehicle_id)));
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.vehicle.id, vehicle.vehicle]));
    const commissionBySaleId = new Map(commissions.map((commission) => [commission.sale_id, commission]));
    const buyerLeadById = new Map(buyerLeads.map((buyerLead) => [buyerLead.id, buyerLead]));
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
        throw new NotFoundException(`Buyer lead ${sale.buyer_lead_id} was not found`);
      }

      return {
        ...mapSaleResponse(sale),
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

  private buildFilteredSalesQuery(query: ListSalesQueryDto = {}) {
    const search = normalizeSearch(query.search);
    const agentName = normalizeOptionalTrimmed(query.agentName);

    let salesQuery = this.db
      .selectFrom('sales.sales')
      .innerJoin('inventory.vehicles', 'inventory.vehicles.id', 'sales.sales.vehicle_id')
      .innerJoin('crm.buyer_leads', 'crm.buyer_leads.id', 'sales.sales.buyer_lead_id')
      .innerJoin('sales.commissions', 'sales.commissions.sale_id', 'sales.sales.id');

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      salesQuery = salesQuery.where(({ eb, or }) =>
        or([
          eb(sql<string>`lower(sales.sales.sale_number)`, 'like', pattern),
          eb(sql<string>`lower(sales.sales.id::text)`, 'like', pattern),
          eb(sql<string>`lower(inventory.vehicles.stock_number)`, 'like', pattern),
          eb(sql<string>`lower(inventory.vehicles.brand)`, 'like', pattern),
          eb(sql<string>`lower(inventory.vehicles.model)`, 'like', pattern),
          eb(sql<string>`lower(coalesce(sales.sales.agent_name, ''))`, 'like', pattern),
          eb(sql<string>`lower(crm.buyer_leads.buyer_name)`, 'like', pattern),
          eb(sql<string>`lower(crm.buyer_leads.contact_number)`, 'like', pattern),
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

  private applyStatusFilter(
    query: SelectQueryBuilder<
      DB,
      'sales.sales' | 'inventory.vehicles' | 'crm.buyer_leads' | 'sales.commissions',
      object
    >,
    status: string,
  ) {
    switch (status) {
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

  private applyDateRangeFilter(
    query: SelectQueryBuilder<
      DB,
      'sales.sales' | 'inventory.vehicles' | 'crm.buyer_leads' | 'sales.commissions',
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
        return query.where('sales.sales.sale_date', '>=', new Date(now.getTime() - 30 * 86_400_000));
      default:
        throw new BadRequestException(`Unsupported sales date range: ${dateRange}`);
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
