import { BadRequestException } from '@nestjs/common';

const DEFAULT_COMMISSION_AMOUNT = '5000.00';

export function getDefaultCommissionAmount() {
  return DEFAULT_COMMISSION_AMOUNT;
}

export function requireTrimmed(value: string | null | undefined, field: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }

  return trimmed;
}

export function normalizeOptionalTrimmed(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseIsoDate(value: string | undefined, field: string) {
  if (!value) {
    throw new BadRequestException(`${field} is required`);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }

  return parsed;
}

export function parseMoneyToCents(value: string | null | undefined, field: string) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new BadRequestException(`${field} is required`);
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new BadRequestException(`${field} must be a valid monetary amount`);
  }

  const [wholePart, decimalPart = ''] = normalized.split('.');
  return Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
}

export function centsToMoney(value: number) {
  return (value / 100).toFixed(2);
}

export function mapSaleResponse(sale: {
  id: string;
  vehicle_id: string;
  buyer_lead_id: string;
  created_by_user_id: string;
  agent_name: string | null;
  sale_date: Date;
  final_sale_amount: string;
  gross_profit_amount: string | null;
  commission_method: string | null;
  commission_locked: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: sale.id,
    vehicleId: sale.vehicle_id,
    buyerLeadId: sale.buyer_lead_id,
    createdByUserId: sale.created_by_user_id,
    agentName: sale.agent_name,
    saleDate: sale.sale_date,
    finalSaleAmount: sale.final_sale_amount,
    grossProfitAmount: sale.gross_profit_amount,
    commissionMethod: sale.commission_method,
    commissionLocked: sale.commission_locked,
    createdAt: sale.created_at,
    updatedAt: sale.updated_at,
  };
}

export function mapCommissionResponse(commission: {
  id: string;
  sale_id: string;
  agent_name: string | null;
  default_amount: string | null;
  override_amount: string | null;
  final_amount: string;
  override_reason: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: commission.id,
    saleId: commission.sale_id,
    agentName: commission.agent_name,
    defaultAmount: commission.default_amount,
    overrideAmount: commission.override_amount,
    finalAmount: commission.final_amount,
    overrideReason: commission.override_reason,
    createdAt: commission.created_at,
    updatedAt: commission.updated_at,
  };
}
