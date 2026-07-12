import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type {
  VehicleCatalogItem,
  VehicleCatalogListResponse,
} from './vehicle-catalog.types';

const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class VehicleCatalogService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async listBrands(): Promise<VehicleCatalogListResponse> {
    const brands = await this.db
      .selectFrom('inventory.vehicle_brands')
      .select(['id', 'name'])
      .orderBy(sql`lower(name)`, 'asc')
      .execute();

    return { items: brands.map((brand) => this.mapCatalogItem(brand)) };
  }

  async createBrand(input: {
    name?: string;
  }): Promise<{ item: VehicleCatalogItem }> {
    const name = this.normalizeName(input.name, 'name');

    try {
      const brand = await this.db
        .insertInto('inventory.vehicle_brands')
        .values({ name })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();

      return { item: this.mapCatalogItem(brand) };
    } catch (error) {
      this.throwDuplicateError(error, `Brand "${name}" already exists`);
      throw error;
    }
  }

  async listModels(brandId?: string): Promise<VehicleCatalogListResponse> {
    const resolvedBrandId = this.requireId(brandId, 'brandId');
    await this.ensureBrandExists(resolvedBrandId);

    const models = await this.db
      .selectFrom('inventory.vehicle_models')
      .select(['id', 'name'])
      .where('brand_id', '=', resolvedBrandId)
      .orderBy(sql`lower(name)`, 'asc')
      .execute();

    return { items: models.map((model) => this.mapCatalogItem(model)) };
  }

  async createModel(input: {
    brandId?: string;
    name?: string;
  }): Promise<{ item: VehicleCatalogItem }> {
    const brandId = this.requireId(input.brandId, 'brandId');
    const name = this.normalizeName(input.name, 'name');
    await this.ensureBrandExists(brandId);

    try {
      const model = await this.db
        .insertInto('inventory.vehicle_models')
        .values({ brand_id: brandId, name })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();

      return { item: this.mapCatalogItem(model) };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Model "${name}" already exists for this brand`,
      );
      throw error;
    }
  }

  async listVariants(modelId?: string): Promise<VehicleCatalogListResponse> {
    const resolvedModelId = this.requireId(modelId, 'modelId');
    await this.ensureModelExists(resolvedModelId);

    const variants = await this.db
      .selectFrom('inventory.vehicle_variants')
      .select(['id', 'name'])
      .where('model_id', '=', resolvedModelId)
      .orderBy(sql`lower(name)`, 'asc')
      .execute();

    return { items: variants.map((variant) => this.mapCatalogItem(variant)) };
  }

  async createVariant(input: {
    modelId?: string;
    name?: string;
  }): Promise<{ item: VehicleCatalogItem }> {
    const modelId = this.requireId(input.modelId, 'modelId');
    const name = this.normalizeName(input.name, 'name');
    await this.ensureModelExists(modelId);

    try {
      const variant = await this.db
        .insertInto('inventory.vehicle_variants')
        .values({ model_id: modelId, name })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();

      return { item: this.mapCatalogItem(variant) };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Variant "${name}" already exists for this model`,
      );
      throw error;
    }
  }

  private normalizeName(value: string | undefined, field: string) {
    const normalized = value?.trim().replace(/\s+/g, ' ');

    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }

    return normalized;
  }

  private requireId(value: string | undefined, field: string) {
    const normalized = value?.trim();

    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }

    return normalized;
  }

  private async ensureBrandExists(brandId: string) {
    const brand = await this.db
      .selectFrom('inventory.vehicle_brands')
      .select('id')
      .where('id', '=', brandId)
      .executeTakeFirst();

    if (!brand) {
      throw new NotFoundException(`Brand ${brandId} was not found`);
    }
  }

  private async ensureModelExists(modelId: string) {
    const model = await this.db
      .selectFrom('inventory.vehicle_models')
      .select('id')
      .where('id', '=', modelId)
      .executeTakeFirst();

    if (!model) {
      throw new NotFoundException(`Model ${modelId} was not found`);
    }
  }

  private mapCatalogItem(row: {
    id: string;
    name: string;
  }): VehicleCatalogItem {
    return {
      id: row.id,
      name: row.name,
    };
  }

  private throwDuplicateError(error: unknown, message: string) {
    if (this.isDatabaseError(error) && error.code === UNIQUE_VIOLATION_CODE) {
      throw new BadRequestException(message);
    }
  }

  private isDatabaseError(error: unknown): error is { code?: string } {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}
