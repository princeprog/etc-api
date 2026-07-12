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
  VehicleCatalogListOptions,
  VehicleCatalogListResponse,
} from './vehicle-catalog.types';

const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class VehicleCatalogService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async listBrands(
    options: VehicleCatalogListOptions = {},
  ): Promise<VehicleCatalogListResponse> {
    let brandsQuery = this.db
      .selectFrom('inventory.vehicle_brands')
      .select(['id', 'name', 'archived_at']);

    brandsQuery = this.applyListFilters(brandsQuery, options);

    const brands = await brandsQuery.orderBy(sql`lower(name)`, 'asc').execute();
    const items = await Promise.all(
      brands.map(async (brand) =>
        this.mapCatalogItem(brand, await this.countBrandUsage(brand.name)),
      ),
    );

    return { items };
  }

  async createBrand(input: {
    name?: string;
  }): Promise<{ item: VehicleCatalogItem }> {
    const name = this.normalizeName(input.name, 'name');

    try {
      const brand = await this.db
        .insertInto('inventory.vehicle_brands')
        .values({ name })
        .returning(['id', 'name', 'archived_at'])
        .executeTakeFirstOrThrow();

      return { item: this.mapCatalogItem(brand, 0) };
    } catch (error) {
      this.throwDuplicateError(error, `Brand "${name}" already exists`);
      throw error;
    }
  }

  async updateBrand(
    id: string,
    input: { name?: string; archived?: boolean },
  ): Promise<{ item: VehicleCatalogItem }> {
    const update = this.buildUpdatePayload(input);

    try {
      const brand = await this.db
        .updateTable('inventory.vehicle_brands')
        .set(update)
        .where('id', '=', this.requireId(id, 'id'))
        .returning(['id', 'name', 'archived_at'])
        .executeTakeFirst();

      if (!brand) {
        throw new NotFoundException(`Brand ${id} was not found`);
      }

      return {
        item: this.mapCatalogItem(
          brand,
          await this.countBrandUsage(brand.name),
        ),
      };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Brand "${input.name ?? ''}" already exists`,
      );
      throw error;
    }
  }

  async listModels(
    brandId?: string,
    options: VehicleCatalogListOptions = {},
  ): Promise<VehicleCatalogListResponse> {
    const resolvedBrandId = this.requireId(brandId, 'brandId');
    await this.ensureBrandExists(resolvedBrandId);

    let modelsQuery = this.db
      .selectFrom('inventory.vehicle_models')
      .innerJoin(
        'inventory.vehicle_brands',
        'inventory.vehicle_brands.id',
        'inventory.vehicle_models.brand_id',
      )
      .select([
        'inventory.vehicle_models.id as id',
        'inventory.vehicle_models.name as name',
        'inventory.vehicle_models.archived_at as archived_at',
        'inventory.vehicle_brands.name as brandName',
      ])
      .where('inventory.vehicle_models.brand_id', '=', resolvedBrandId);

    modelsQuery = this.applyListFilters(
      modelsQuery,
      options,
      'inventory.vehicle_models',
    );

    const models = await modelsQuery.orderBy(sql`lower(name)`, 'asc').execute();
    const items = await Promise.all(
      models.map(async (model) =>
        this.mapCatalogItem(
          model,
          await this.countModelUsage(model.brandName, model.name),
        ),
      ),
    );

    return { items };
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
        .returning(['id', 'name', 'archived_at'])
        .executeTakeFirstOrThrow();

      return { item: this.mapCatalogItem(model, 0) };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Model "${name}" already exists for this brand`,
      );
      throw error;
    }
  }

  async updateModel(
    id: string,
    input: { name?: string; archived?: boolean },
  ): Promise<{ item: VehicleCatalogItem }> {
    const update = this.buildUpdatePayload(input);

    try {
      const model = await this.db
        .updateTable('inventory.vehicle_models')
        .set(update)
        .where('id', '=', this.requireId(id, 'id'))
        .returning(['id', 'name', 'brand_id', 'archived_at'])
        .executeTakeFirst();

      if (!model) {
        throw new NotFoundException(`Model ${id} was not found`);
      }

      const brand = await this.getBrandName(model.brand_id);

      return {
        item: this.mapCatalogItem(
          model,
          await this.countModelUsage(brand, model.name),
        ),
      };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Model "${input.name ?? ''}" already exists for this brand`,
      );
      throw error;
    }
  }

  async listVariants(
    modelId?: string,
    options: VehicleCatalogListOptions = {},
  ): Promise<VehicleCatalogListResponse> {
    const resolvedModelId = this.requireId(modelId, 'modelId');
    await this.ensureModelExists(resolvedModelId);

    let variantsQuery = this.db
      .selectFrom('inventory.vehicle_variants')
      .innerJoin(
        'inventory.vehicle_models',
        'inventory.vehicle_models.id',
        'inventory.vehicle_variants.model_id',
      )
      .innerJoin(
        'inventory.vehicle_brands',
        'inventory.vehicle_brands.id',
        'inventory.vehicle_models.brand_id',
      )
      .select([
        'inventory.vehicle_variants.id as id',
        'inventory.vehicle_variants.name as name',
        'inventory.vehicle_variants.archived_at as archived_at',
        'inventory.vehicle_models.name as modelName',
        'inventory.vehicle_brands.name as brandName',
      ])
      .where('inventory.vehicle_variants.model_id', '=', resolvedModelId);

    variantsQuery = this.applyListFilters(
      variantsQuery,
      options,
      'inventory.vehicle_variants',
    );

    const variants = await variantsQuery
      .orderBy(sql`lower(inventory.vehicle_variants.name)`, 'asc')
      .execute();
    const items = await Promise.all(
      variants.map(async (variant) =>
        this.mapCatalogItem(
          variant,
          await this.countVariantUsage(
            variant.brandName,
            variant.modelName,
            variant.name,
          ),
        ),
      ),
    );

    return { items };
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
        .returning(['id', 'name', 'archived_at'])
        .executeTakeFirstOrThrow();

      return { item: this.mapCatalogItem(variant, 0) };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Variant "${name}" already exists for this model`,
      );
      throw error;
    }
  }

  async updateVariant(
    id: string,
    input: { name?: string; archived?: boolean },
  ): Promise<{ item: VehicleCatalogItem }> {
    const update = this.buildUpdatePayload(input);

    try {
      const variant = await this.db
        .updateTable('inventory.vehicle_variants')
        .set(update)
        .where('id', '=', this.requireId(id, 'id'))
        .returning(['id', 'name', 'model_id', 'archived_at'])
        .executeTakeFirst();

      if (!variant) {
        throw new NotFoundException(`Variant ${id} was not found`);
      }

      const model = await this.getModelContext(variant.model_id);

      return {
        item: this.mapCatalogItem(
          variant,
          await this.countVariantUsage(
            model.brandName,
            model.name,
            variant.name,
          ),
        ),
      };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Variant "${input.name ?? ''}" already exists for this model`,
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

  private mapCatalogItem(
    row: {
      id: string;
      name: string;
      archived_at: Date | null;
    },
    usageCount: number,
  ): VehicleCatalogItem {
    return {
      id: row.id,
      name: row.name,
      archivedAt: row.archived_at,
      usageCount,
    };
  }

  private applyListFilters<
    TQuery extends { where: (...args: any[]) => TQuery },
  >(
    query: TQuery,
    options: VehicleCatalogListOptions,
    tableName = 'inventory.vehicle_brands',
  ) {
    let nextQuery = query;

    if (!this.parseBoolean(options.includeArchived)) {
      nextQuery = nextQuery.where(`${tableName}.archived_at`, 'is', null);
    }

    const search = options.search?.trim().toLowerCase();

    if (search) {
      nextQuery = nextQuery.where(
        sql`lower(${sql.ref(`${tableName}.name`)})`,
        'like',
        `%${search}%`,
      );
    }

    return nextQuery;
  }

  private buildUpdatePayload(input: { name?: string; archived?: boolean }) {
    const update: {
      name?: string;
      archived_at?: Date | null;
      updated_at: Date;
    } = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) {
      update.name = this.normalizeName(input.name, 'name');
    }

    if (input.archived !== undefined) {
      update.archived_at = input.archived ? new Date() : null;
    }

    if (update.name === undefined && update.archived_at === undefined) {
      throw new BadRequestException('name or archived is required');
    }

    return update;
  }

  private parseBoolean(value: unknown) {
    return value === true || value === 'true';
  }

  private async getBrandName(brandId: string) {
    const brand = await this.db
      .selectFrom('inventory.vehicle_brands')
      .select('name')
      .where('id', '=', brandId)
      .executeTakeFirst();

    if (!brand) {
      throw new NotFoundException(`Brand ${brandId} was not found`);
    }

    return brand.name;
  }

  private async getModelContext(modelId: string) {
    const model = await this.db
      .selectFrom('inventory.vehicle_models')
      .innerJoin(
        'inventory.vehicle_brands',
        'inventory.vehicle_brands.id',
        'inventory.vehicle_models.brand_id',
      )
      .select([
        'inventory.vehicle_models.name as name',
        'inventory.vehicle_brands.name as brandName',
      ])
      .where('inventory.vehicle_models.id', '=', modelId)
      .executeTakeFirst();

    if (!model) {
      throw new NotFoundException(`Model ${modelId} was not found`);
    }

    return model;
  }

  private async countBrandUsage(brandName: string) {
    const row = await this.db
      .selectFrom('inventory.vehicles')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where(sql`lower(brand)`, '=', brandName.toLowerCase())
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  private async countModelUsage(brandName: string, modelName: string) {
    const row = await this.db
      .selectFrom('inventory.vehicles')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where(sql`lower(brand)`, '=', brandName.toLowerCase())
      .where(sql`lower(model)`, '=', modelName.toLowerCase())
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  private async countVariantUsage(
    brandName: string,
    modelName: string,
    variantName: string,
  ) {
    const row = await this.db
      .selectFrom('inventory.vehicles')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where(sql`lower(brand)`, '=', brandName.toLowerCase())
      .where(sql`lower(model)`, '=', modelName.toLowerCase())
      .where(sql`lower(variant)`, '=', variantName.toLowerCase())
      .executeTakeFirstOrThrow();

    return Number(row.count);
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
