import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { VehiclesService } from '../vehicles/vehicles.service';
import { CreateSaleDto } from './dto/create-sale.dto';
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

  async findAll() {
    const sales = await this.db
      .selectFrom('sales.sales')
      .select(['id'])
      .orderBy('sale_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();

    return {
      sales: await Promise.all(
        sales.map((sale) => this.getSaleOrThrow(sale.id)),
      ),
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

    return {
      ...mapSaleResponse(sale),
      commission: mapCommissionResponse(commission),
      vehicle: (await this.vehiclesService.findOne(sale.vehicle_id)).vehicle,
    };
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
}
