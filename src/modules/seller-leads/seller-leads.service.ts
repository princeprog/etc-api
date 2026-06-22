import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { VehiclesService } from '../vehicles/vehicles.service';
import {
  mapVehicleResponse,
  parseVehicleStatus,
} from '../vehicles/vehicles.helpers';
import { ConvertSellerLeadDto } from './dto/convert-seller-lead.dto';
import { CreateSellerLeadDto } from './dto/create-seller-lead.dto';
import { UpdateSellerLeadDto } from './dto/update-seller-lead.dto';
import {
  mapSellerLeadResponse,
  parseSellerLeadStatus,
} from './seller-leads.helpers';

@Injectable()
export class SellerLeadsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly vehiclesService: VehiclesService,
  ) {}

  async create(createSellerLeadDto: CreateSellerLeadDto) {
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
        asking_price: createSellerLeadDto.askingPrice ?? null,
        region: createSellerLeadDto.region ?? null,
        notes: createSellerLeadDto.notes ?? null,
        status: parseSellerLeadStatus(
          createSellerLeadDto.status,
          'New Inquiry',
        ),
        assignee_user_id: createSellerLeadDto.assigneeUserId ?? null,
        closing_note: createSellerLeadDto.closingNote ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      sellerLead: mapSellerLeadResponse({
        ...sellerLead,
        status: parseSellerLeadStatus(sellerLead.status, 'New Inquiry'),
      }),
    };
  }

  async findAll() {
    const sellerLeads = await this.db
      .selectFrom('crm.seller_leads')
      .selectAll()
      .orderBy('created_at desc')
      .execute();

    return {
      sellerLeads: sellerLeads.map((lead) =>
        mapSellerLeadResponse({
          ...lead,
          status: parseSellerLeadStatus(lead.status, 'New Inquiry'),
        }),
      ),
    };
  }

  async findOne(id: string) {
    const sellerLead = await this.getLeadRecordOrThrow(id);
    return { sellerLead: mapSellerLeadResponse(sellerLead) };
  }

  async update(id: string, updateSellerLeadDto: UpdateSellerLeadDto) {
    await this.getLeadRecordOrThrow(id);

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
          ? { asking_price: updateSellerLeadDto.askingPrice ?? null }
          : {}),
        ...(updateSellerLeadDto.region !== undefined
          ? { region: updateSellerLeadDto.region ?? null }
          : {}),
        ...(updateSellerLeadDto.notes !== undefined
          ? { notes: updateSellerLeadDto.notes ?? null }
          : {}),
        ...(updateSellerLeadDto.status !== undefined
          ? {
              status: parseSellerLeadStatus(
                updateSellerLeadDto.status,
                'New Inquiry',
              ),
            }
          : {}),
        ...(updateSellerLeadDto.assigneeUserId !== undefined
          ? { assignee_user_id: updateSellerLeadDto.assigneeUserId ?? null }
          : {}),
        ...(updateSellerLeadDto.closingNote !== undefined
          ? { closing_note: updateSellerLeadDto.closingNote ?? null }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    const sellerLead = await this.getLeadRecordOrThrow(id);
    return { sellerLead: mapSellerLeadResponse(sellerLead) };
  }

  async convert(id: string, convertSellerLeadDto: ConvertSellerLeadDto) {
    return this.db.transaction().execute(async (trx) => {
      const sellerLead = await trx
        .selectFrom('crm.seller_leads')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();

      if (!sellerLead) {
        throw new NotFoundException(`Seller lead ${id} was not found`);
      }

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
          convertSellerLeadDto.purchasePrice ?? sellerLead.asking_price,
        targetSellingPrice: convertSellerLeadDto.targetSellingPrice,
        minimumAcceptablePrice: convertSellerLeadDto.minimumAcceptablePrice,
        acquisitionSource:
          convertSellerLeadDto.acquisitionSource ?? sellerLead.inquiry_source,
        sellerLeadId: sellerLead.id,
        status: convertSellerLeadDto.status ?? 'Incoming',
        photos: convertSellerLeadDto.photos,
      });
      const stockNumber = await this.vehiclesService.allocateStockNumber(trx);

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

      const updatedLead = await trx
        .selectFrom('crm.seller_leads')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

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
        sellerLead: mapSellerLeadResponse({
          ...updatedLead,
          status: parseSellerLeadStatus(updatedLead.status, 'Purchased'),
        }),
        vehicle: mapVehicleResponse({
          ...persistedVehicle,
          status: parseVehicleStatus(persistedVehicle.status, 'Incoming'),
          photos: persistedPhotos.map((photo) => ({
            fileUrl: photo.file_url,
            sortOrder: photo.sort_order,
          })),
        }),
      };
    });
  }

  private async getLeadRecordOrThrow(id: string) {
    const sellerLead = await this.db
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
    };
  }

  private requireNonEmpty(value: string, field: string) {
    const trimmed = value?.trim();

    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }

    return trimmed;
  }
}
