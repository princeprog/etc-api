import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export type PaginationParams = {
  page: number;
  pageSize: number;
  offset: number;
};

export function parsePositiveInteger(
  value: number | string | undefined,
  field: string,
  fallback: number,
) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  return parsed;
}

export function parsePageSize(value: number | string | undefined) {
  const pageSize = parsePositiveInteger(value, 'pageSize', DEFAULT_PAGE_SIZE);

  if (pageSize > MAX_PAGE_SIZE) {
    throw new BadRequestException(`pageSize must not exceed ${MAX_PAGE_SIZE}`);
  }

  return pageSize;
}

export function parsePagination(params: { page?: number | string; pageSize?: number | string }) {
  const page = parsePositiveInteger(params.page, 'page', DEFAULT_PAGE);
  const pageSize = parsePageSize(params.pageSize);

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  } satisfies PaginationParams;
}

export function buildPaginatedResponse<T>(
  items: T[],
  pagination: PaginationParams,
  total: number,
) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    items,
  };
}

export function normalizeSearch(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
