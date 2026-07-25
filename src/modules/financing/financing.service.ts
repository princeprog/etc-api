import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';

import { PERMISSIONS, hasAllPermission } from '../../common/auth/permissions';
import type { CurrentUser } from '../../common/types/auth.types';
import {
  buildPaginatedResponse,
  normalizeSearch,
  parsePagination,
} from '../../common/utils/list-query.utils';
import { CloudinaryStorageService } from '../../common/storage/cloudinary-storage.service';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type {
  FinancingApplicationStatus,
  FinancingRequirementStatus,
} from '../../database/schema';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import type {
  CancelFinancingApplicationDto,
  CreateFinancingApplicationDto,
  CreateFinancingPartnerDto,
  CreateRequirementTemplateDto,
  DecideFinancingApplicationDto,
  ListFinancingApplicationsQueryDto,
  RecordLoanReleaseDto,
  RecordVehicleReleaseDto,
  ReviewFinancingRequirementDto,
  UpdateFinancingApplicationDto,
  UpdateFinancingPartnerDto,
  UpdateRequirementTemplateDto,
  UpsertPartnerRepresentativeDto,
} from './dto/financing.dto';
import {
  addDays,
  buildUploadSessionToken,
  generateUploadToken,
  getFinancingDocumentUrlTtlSeconds,
  getFinancingUploadLinkTtlDays,
  getFinancingUploadSessionSecret,
  getFinancingUploadSessionTtlMinutes,
  hashUploadToken,
  isAllowedFinancingDocument,
  normalizeContactNumber,
  verifyUploadSessionToken,
} from './financing.helpers';

type UploadedFinancingFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const TERMINAL_APPLICATION_STATUSES: FinancingApplicationStatus[] = [
  'rejected',
  'vehicle_released',
  'cancelled',
];

const applicationSummarySelects = [
  'app.id as id',
  'app.application_number as application_number',
  'app.buyer_lead_id as buyer_lead_id',
  'app.vehicle_id as vehicle_id',
  'app.assigned_staff_user_id as assigned_staff_user_id',
  'app.partner_id as partner_id',
  'app.representative_user_id as representative_user_id',
  'app.status as status',
  'app.requested_amount as requested_amount',
  'app.down_payment as down_payment',
  'app.term_months as term_months',
  'app.decision_note as decision_note',
  'app.decided_at as decided_at',
  'app.released_loan_amount as released_loan_amount',
  'app.loan_released_at as loan_released_at',
  'app.loan_release_reference as loan_release_reference',
  'app.vehicle_released_at as vehicle_released_at',
  'app.vehicle_release_note as vehicle_release_note',
  'app.created_at as created_at',
  'app.updated_at as updated_at',
  'buyer.buyer_name as buyer_name',
  'buyer.contact_number as buyer_contact_number',
  'vehicle.stock_number as vehicle_stock_number',
  'vehicle.year as vehicle_year',
  'vehicle.brand as vehicle_brand',
  'vehicle.model as vehicle_model',
  'vehicle.variant as vehicle_variant',
  'partner.name as partner_name',
  'rep.full_name as representative_full_name',
  'staff.full_name as assigned_staff_full_name',
] as const;

@Injectable()
export class FinancingService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
    private readonly cloudinaryStorageService: CloudinaryStorageService,
  ) {}

  async listPartners() {
    const partners = await this.db
      .selectFrom('finance.financing_partners')
      .selectAll()
      .orderBy('name')
      .execute();

    if (!partners.length) {
      return { partners: [] };
    }

    const representatives = await this.db
      .selectFrom('finance.financing_partner_representatives as representative')
      .innerJoin('authentication.users as user', 'user.id', 'representative.user_id')
      .leftJoin('authentication.roles as role', 'role.id', 'user.role_id')
      .select([
        'representative.id as id',
        'representative.partner_id as partnerId',
        'representative.user_id as userId',
        'representative.is_active as isActive',
        'representative.created_at as createdAt',
        'representative.updated_at as updatedAt',
        'user.full_name as fullName',
        'user.email as email',
        'role.name as roleName',
      ])
      .where(
        'representative.partner_id',
        'in',
        partners.map((partner) => partner.id),
      )
      .orderBy('user.full_name')
      .execute();
    const representativesByPartner = groupBy(
      representatives,
      (representative) => representative.partnerId,
    );

    return {
      partners: partners.map((partner) =>
        mapPartner(
          partner,
          representativesByPartner.get(partner.id)?.map(mapRepresentativeDetail) ?? [],
        ),
      ),
    };
  }

  async createPartner(user: CurrentUser, dto: CreateFinancingPartnerDto) {
    const partner = await this.db
      .insertInto('finance.financing_partners')
      .values({
        name: requireTrimmed(dto.name, 'name'),
        contact_person: normalizeOptionalTrimmed(dto.contactPerson),
        contact_number: normalizeOptionalTrimmed(dto.contactNumber),
        email: normalizeOptionalTrimmed(dto.email),
        notes: normalizeOptionalTrimmed(dto.notes),
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { partner: mapPartner(partner) };
  }

  async updatePartner(
    user: CurrentUser,
    id: string,
    dto: UpdateFinancingPartnerDto,
  ) {
    const partner = await this.db
      .updateTable('finance.financing_partners')
      .set({
        ...(dto.name !== undefined
          ? { name: requireTrimmed(dto.name, 'name') }
          : {}),
        ...(dto.contactPerson !== undefined
          ? { contact_person: normalizeOptionalTrimmed(dto.contactPerson) }
          : {}),
        ...(dto.contactNumber !== undefined
          ? { contact_number: normalizeOptionalTrimmed(dto.contactNumber) }
          : {}),
        ...(dto.email !== undefined
          ? { email: normalizeOptionalTrimmed(dto.email) }
          : {}),
        ...(dto.notes !== undefined
          ? { notes: normalizeOptionalTrimmed(dto.notes) }
          : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!partner) {
      throw new NotFoundException('Financing partner was not found');
    }

    return { partner: mapPartner(partner) };
  }

  async upsertRepresentative(
    partnerId: string,
    dto: UpsertPartnerRepresentativeDto,
  ) {
    await this.ensurePartnerExists(partnerId);
    await this.ensureActiveUser(dto.userId);

    const representative = await this.db
      .insertInto('finance.financing_partner_representatives')
      .values({
        partner_id: partnerId,
        user_id: requireTrimmed(dto.userId, 'userId'),
        is_active: dto.isActive ?? true,
      })
      .onConflict((oc) =>
        oc.columns(['partner_id', 'user_id']).doUpdateSet({
          is_active: dto.isActive ?? true,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return { representative: mapRepresentative(representative) };
  }

  async listTemplates(partnerId?: string) {
    let query = this.db
      .selectFrom('finance.financing_requirement_templates')
      .selectAll();

    if (partnerId) {
      query = query.where('partner_id', '=', partnerId);
    }

    const templates = await query.orderBy('created_at', 'desc').execute();
    if (!templates.length) {
      return { templates: [] };
    }

    const items = await this.db
      .selectFrom('finance.financing_requirement_template_items')
      .selectAll()
      .where(
        'template_id',
        'in',
        templates.map((template) => template.id),
      )
      .orderBy('sort_order')
      .execute();
    const itemsByTemplate = groupBy(items, (item) => item.template_id);

    return {
      templates: templates.map((template) =>
        mapTemplate(template, itemsByTemplate.get(template.id) ?? []),
      ),
    };
  }

  async createTemplate(user: CurrentUser, dto: CreateRequirementTemplateDto) {
    await this.ensurePartnerExists(dto.partnerId);

    const template = await this.db.transaction().execute(async (trx) => {
      if (dto.isDefault) {
        await this.clearDefaultTemplate(dto.partnerId, trx);
      }

      const inserted = await trx
        .insertInto('finance.financing_requirement_templates')
        .values({
          partner_id: requireTrimmed(dto.partnerId, 'partnerId'),
          name: requireTrimmed(dto.name, 'name'),
          description: normalizeOptionalTrimmed(dto.description),
          is_default: dto.isDefault ?? false,
          created_by_user_id: user.id,
          updated_by_user_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.replaceTemplateItems(inserted.id, dto.items ?? [], trx);
      return inserted;
    });

    return { template: await this.getTemplateResponse(template.id) };
  }

  async updateTemplate(
    user: CurrentUser,
    id: string,
    dto: UpdateRequirementTemplateDto,
  ) {
    const existing = await this.getTemplateOrThrow(id);

    await this.db.transaction().execute(async (trx) => {
      if (dto.isDefault) {
        await this.clearDefaultTemplate(existing.partner_id, trx);
      }

      const updated = await trx
        .updateTable('finance.financing_requirement_templates')
        .set({
          ...(dto.name !== undefined
            ? { name: requireTrimmed(dto.name, 'name') }
            : {}),
          ...(dto.description !== undefined
            ? { description: normalizeOptionalTrimmed(dto.description) }
            : {}),
          ...(dto.isDefault !== undefined ? { is_default: dto.isDefault } : {}),
          ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
          updated_by_user_id: user.id,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new NotFoundException('Requirement template was not found');
      }

      if (dto.items) {
        await this.replaceTemplateItems(id, dto.items, trx);
      }
    });

    return { template: await this.getTemplateResponse(id) };
  }

  async listApplications(
    user: CurrentUser,
    query: ListFinancingApplicationsQueryDto = {},
  ) {
    const pagination = parsePagination(query);
    const search = normalizeSearch(query.search);
    let baseQuery = this.buildApplicationListQuery(user);

    if (search) {
      const pattern = `%${search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('app.application_number', 'ilike', pattern),
          eb('buyer.buyer_name', 'ilike', pattern),
          eb('vehicle.stock_number', 'ilike', pattern),
          eb('partner.name', 'ilike', pattern),
        ]),
      );
    }

    if (query.status && query.status !== 'all') {
      baseQuery = baseQuery.where('app.status', '=', query.status);
    }
    if (query.partnerId) {
      baseQuery = baseQuery.where('app.partner_id', '=', query.partnerId);
    }
    if (query.representativeUserId) {
      baseQuery = baseQuery.where(
        'app.representative_user_id',
        '=',
        query.representativeUserId,
      );
    }
    if (query.assignedStaffUserId) {
      baseQuery = baseQuery.where(
        'app.assigned_staff_user_id',
        '=',
        query.assignedStaffUserId,
      );
    }
    if (query.dateFrom) {
      baseQuery = baseQuery.where('app.created_at', '>=', parseDate(query.dateFrom));
    }
    if (query.dateTo) {
      baseQuery = baseQuery.where('app.created_at', '<=', parseDate(query.dateTo));
    }

    const totalRow = await baseQuery
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();
    const rows = await baseQuery
      .select(applicationSummarySelects)
      .orderBy('app.updated_at', 'desc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();
    const progress = await this.getRequirementProgress(rows.map((row) => row.id));
    const response = buildPaginatedResponse(
      rows.map((row) =>
        mapApplicationSummary(row, progress.get(row.id) ?? defaultProgress()),
      ),
      pagination,
      Number(totalRow.total),
    );

    return {
      applications: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async getApplication(user: CurrentUser, id: string) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingView);

    return { application: await this.getApplicationResponse(id) };
  }

  async createApplication(user: CurrentUser, dto: CreateFinancingApplicationDto) {
    const buyerLead = await this.getBuyerLeadOrThrow(dto.buyerLeadId);
    await this.getVehicleOrThrow(dto.vehicleId);
    await this.ensureRepresentativeMembership(dto.partnerId, dto.representativeUserId);
    const assignedStaffUserId =
      normalizeOptionalTrimmed(dto.assignedStaffUserId) ??
      buyerLead.assignee_user_id ??
      user.id;
    await this.ensureActiveUser(assignedStaffUserId);
    const templateId =
      normalizeOptionalTrimmed(dto.templateId) ??
      (await this.getDefaultTemplateId(dto.partnerId));

    if (!templateId) {
      throw new BadRequestException(
        'A requirement template is required for this financing partner',
      );
    }

    const applicationId = await this.db.transaction().execute(async (trx) => {
      const app = await trx
        .insertInto('finance.financing_applications')
        .values({
          application_number: await this.allocateApplicationNumber(trx),
          buyer_lead_id: requireTrimmed(dto.buyerLeadId, 'buyerLeadId'),
          vehicle_id: requireTrimmed(dto.vehicleId, 'vehicleId'),
          assigned_staff_user_id: assignedStaffUserId,
          partner_id: requireTrimmed(dto.partnerId, 'partnerId'),
          representative_user_id: requireTrimmed(
            dto.representativeUserId,
            'representativeUserId',
          ),
          template_id: templateId,
          requested_amount: normalizeOptionalTrimmed(dto.requestedAmount),
          down_payment: normalizeOptionalTrimmed(dto.downPayment),
          term_months: dto.termMonths ?? null,
          created_by_user_id: user.id,
          updated_by_user_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.copyTemplateRequirements(app.id, templateId, trx);
      await this.writeActivity(
        user,
        app.id,
        'financing.created',
        `Financing application ${app.application_number} created`,
        trx,
      );

      return app.id;
    });

    await this.notifyUsers([dto.representativeUserId], {
      type: 'financing_requirements_submitted',
      title: 'Financing application assigned',
      message: `${buyerLead.buyer_name} has a financing application assigned to you.`,
      entityId: applicationId,
    });

    return { application: await this.getApplicationResponse(applicationId) };
  }

  async updateApplication(
    user: CurrentUser,
    id: string,
    dto: UpdateFinancingApplicationDto,
  ) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingUpdate);
    this.assertNotTerminal(app);

    if (dto.partnerId || dto.representativeUserId) {
      await this.ensureRepresentativeMembership(
        dto.partnerId ?? app.partner_id,
        dto.representativeUserId ?? app.representative_user_id,
      );
    }

    const updated = await this.db
      .updateTable('finance.financing_applications')
      .set({
        ...(dto.partnerId ? { partner_id: dto.partnerId } : {}),
        ...(dto.representativeUserId
          ? { representative_user_id: dto.representativeUserId }
          : {}),
        ...(dto.assignedStaffUserId
          ? { assigned_staff_user_id: dto.assignedStaffUserId }
          : {}),
        ...(dto.requestedAmount !== undefined
          ? { requested_amount: normalizeOptionalTrimmed(dto.requestedAmount) }
          : {}),
        ...(dto.downPayment !== undefined
          ? { down_payment: normalizeOptionalTrimmed(dto.downPayment) }
          : {}),
        ...(dto.termMonths !== undefined ? { term_months: dto.termMonths } : {}),
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeActivity(
      user,
      id,
      'financing.updated',
      `Financing application ${updated.application_number} updated`,
    );

    return { application: await this.getApplicationResponse(id) };
  }

  async generateUploadLink(user: CurrentUser, id: string) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingUpdate);
    this.assertNotTerminal(app);

    const rawToken = generateUploadToken();
    const expiresAt = addDays(new Date(), getFinancingUploadLinkTtlDays());

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('finance.financing_upload_links')
        .set({ revoked_at: new Date() })
        .where('application_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();

      await trx
        .insertInto('finance.financing_upload_links')
        .values({
          application_id: id,
          token_hash: hashUploadToken(rawToken),
          expires_at: expiresAt,
          created_by_user_id: user.id,
        })
        .execute();

      if (app.status === 'draft') {
        await trx
          .updateTable('finance.financing_applications')
          .set({
            status: 'collecting_requirements',
            updated_by_user_id: user.id,
            updated_at: new Date(),
          })
          .where('id', '=', id)
          .execute();
      }

      await this.writeActivity(
        user,
        id,
        'financing.upload_link_generated',
        `Upload link generated for ${app.application_number}`,
        trx,
      );
    });

    return {
      uploadLink: {
        token: rawToken,
        expiresAt,
      },
    };
  }

  async revokeUploadLink(user: CurrentUser, id: string) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingUpdate);

    await this.db
      .updateTable('finance.financing_upload_links')
      .set({ revoked_at: new Date() })
      .where('application_id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
    await this.writeActivity(
      user,
      id,
      'financing.upload_link_revoked',
      `Upload link revoked for ${app.application_number}`,
    );

    return { revoked: true };
  }

  async uploadRequirementDocument(
    user: CurrentUser,
    applicationId: string,
    requirementId: string,
    file: UploadedFinancingFile,
  ) {
    const app = await this.getApplicationModelOrThrow(applicationId);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingUpdate);
    this.assertUploadAllowed(app);

    await this.storeDocumentVersion({
      applicationId,
      requirementId,
      file,
      uploadedByUserId: user.id,
    });
    await this.writeActivity(
      user,
      applicationId,
      'financing.document_uploaded',
      `Requirement document uploaded for ${app.application_number}`,
    );

    return { application: await this.getApplicationResponse(applicationId) };
  }

  async reviewRequirement(
    user: CurrentUser,
    applicationId: string,
    requirementId: string,
    dto: ReviewFinancingRequirementDto,
  ) {
    const app = await this.getApplicationModelOrThrow(applicationId);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingReview);

    if (app.status !== 'under_review') {
      throw new BadRequestException('Requirements can only be reviewed while under review');
    }

    const nextStatus = dto.status;
    if (nextStatus === 'revision_requested' && !normalizeOptionalTrimmed(dto.revisionReason)) {
      throw new BadRequestException('A revision reason is required');
    }

    await this.db.transaction().execute(async (trx) => {
      const requirement = await trx
        .updateTable('finance.financing_application_requirements')
        .set({
          status: nextStatus,
          review_note: normalizeOptionalTrimmed(dto.note),
          revision_reason:
            nextStatus === 'revision_requested'
              ? normalizeOptionalTrimmed(dto.revisionReason)
              : null,
          reviewed_by_user_id: user.id,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', requirementId)
        .where('application_id', '=', applicationId)
        .returningAll()
        .executeTakeFirst();

      if (!requirement) {
        throw new NotFoundException('Requirement was not found');
      }

      if (nextStatus === 'revision_requested') {
        await trx
          .updateTable('finance.financing_applications')
          .set({
            status: 'needs_revision',
            updated_by_user_id: user.id,
            updated_at: new Date(),
          })
          .where('id', '=', applicationId)
          .execute();
      }

      await this.writeActivity(
        user,
        applicationId,
        nextStatus === 'accepted'
          ? 'financing.requirement_accepted'
          : 'financing.revision_requested',
        `${requirement.label} ${nextStatus === 'accepted' ? 'accepted' : 'needs revision'}`,
        trx,
      );
    });

    await this.notifyUsers([app.assigned_staff_user_id], {
      type: 'financing_revision_requested',
      title: 'Financing requirement updated',
      message: `A financing requirement for ${app.application_number} was reviewed.`,
      entityId: applicationId,
    });

    return { application: await this.getApplicationResponse(applicationId) };
  }

  async decideApplication(
    user: CurrentUser,
    id: string,
    dto: DecideFinancingApplicationDto,
  ) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingDecide);

    if (app.status !== 'under_review') {
      throw new BadRequestException('Only under-review applications can be decided');
    }

    if (dto.decision === 'approved') {
      await this.ensureAllRequiredAccepted(id);
    } else if (!normalizeOptionalTrimmed(dto.note)) {
      throw new BadRequestException('A rejection reason is required');
    }

    await this.db
      .updateTable('finance.financing_applications')
      .set({
        status: dto.decision,
        decision_note: normalizeOptionalTrimmed(dto.note),
        decided_by_user_id: user.id,
        decided_at: new Date(),
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    await this.writeActivity(
      user,
      id,
      dto.decision === 'approved' ? 'financing.approved' : 'financing.rejected',
      `Financing application ${app.application_number} ${dto.decision}`,
    );
    await this.notifyUsers([app.assigned_staff_user_id], {
      type: dto.decision === 'approved' ? 'financing_approved' : 'financing_rejected',
      title: `Financing ${dto.decision}`,
      message: `${app.application_number} was ${dto.decision}.`,
      entityId: id,
    });

    return { application: await this.getApplicationResponse(id) };
  }

  async recordLoanRelease(user: CurrentUser, id: string, dto: RecordLoanReleaseDto) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingRecordLoanRelease);

    if (app.status !== 'approved') {
      throw new BadRequestException('Only approved applications can record loan release');
    }

    await this.db
      .updateTable('finance.financing_applications')
      .set({
        status: 'loan_released',
        released_loan_amount: requireTrimmed(dto.releasedLoanAmount, 'releasedLoanAmount'),
        loan_released_at: parseDate(dto.loanReleasedAt),
        loan_release_reference: normalizeOptionalTrimmed(dto.loanReleaseReference),
        loan_released_by_user_id: user.id,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    await this.writeActivity(user, id, 'financing.loan_released', `Loan released for ${app.application_number}`);
    await this.notifyUsers([app.assigned_staff_user_id], {
      type: 'financing_loan_released',
      title: 'Financing loan released',
      message: `${app.application_number} is ready for sale finalization.`,
      entityId: id,
    });

    return { application: await this.getApplicationResponse(id) };
  }

  async recordVehicleRelease(
    user: CurrentUser,
    id: string,
    dto: RecordVehicleReleaseDto,
  ) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingRecordVehicleRelease);

    if (app.status !== 'loan_released') {
      throw new BadRequestException('Only loan-released applications can record vehicle release');
    }

    const sale = await this.db
      .selectFrom('sales.sales')
      .select(['id'])
      .where('buyer_lead_id', '=', app.buyer_lead_id)
      .where('vehicle_id', '=', app.vehicle_id)
      .where('financing_application_id', '=', app.id)
      .executeTakeFirst();

    if (!sale) {
      throw new BadRequestException('A matching finalized financed sale is required first');
    }

    await this.db
      .updateTable('finance.financing_applications')
      .set({
        status: 'vehicle_released',
        vehicle_released_at: dto.vehicleReleasedAt
          ? parseDate(dto.vehicleReleasedAt)
          : new Date(),
        vehicle_release_note: normalizeOptionalTrimmed(dto.note),
        vehicle_released_by_user_id: user.id,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await this.writeActivity(user, id, 'financing.vehicle_released', `Vehicle released for ${app.application_number}`);

    return { application: await this.getApplicationResponse(id) };
  }

  async cancelApplication(user: CurrentUser, id: string, dto: CancelFinancingApplicationDto) {
    const app = await this.getApplicationModelOrThrow(id);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingUpdate);
    this.assertNotTerminal(app);

    await this.db
      .updateTable('finance.financing_applications')
      .set({
        status: 'cancelled',
        cancelled_at: new Date(),
        cancelled_by_user_id: user.id,
        cancellation_reason: requireTrimmed(dto.reason, 'reason'),
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await this.writeActivity(user, id, 'financing.cancelled', `Financing application ${app.application_number} cancelled`);

    return { application: await this.getApplicationResponse(id) };
  }

  async verifyPublicUpload(token: string, contactNumber: string, ipAddress: string) {
    const link = await this.getActiveUploadLink(token);
    await this.enforceVerificationRateLimit(link.id, ipAddress);
    const app = await this.getApplicationModelOrThrow(link.application_id);
    const buyer = await this.getBuyerLeadOrThrow(app.buyer_lead_id);
    const matches =
      normalizeContactNumber(contactNumber) ===
      normalizeContactNumber(buyer.contact_number);

    await this.db
      .insertInto('finance.financing_upload_verification_attempts')
      .values({
        upload_link_id: link.id,
        ip_address: ipAddress,
        succeeded: matches,
      })
      .execute();

    if (!matches) {
      throw new ForbiddenException('Invalid or expired upload link');
    }

    return {
      sessionToken: buildUploadSessionToken({
        applicationId: app.id,
        uploadLinkId: link.id,
        secret: getFinancingUploadSessionSecret(),
        ttlMinutes: getFinancingUploadSessionTtlMinutes(),
      }),
      application: await this.getPublicApplicationResponse(app.id),
    };
  }

  async getPublicChecklist(token: string, sessionToken: string | undefined) {
    const link = await this.getActiveUploadLink(token);
    this.verifyPublicSession(sessionToken, link.application_id);
    return { application: await this.getPublicApplicationResponse(link.application_id) };
  }

  async uploadPublicRequirementDocument(
    token: string,
    sessionToken: string | undefined,
    requirementId: string,
    file: UploadedFinancingFile,
  ) {
    const link = await this.getActiveUploadLink(token);
    const session = this.verifyPublicSession(sessionToken, link.application_id);
    const app = await this.getApplicationModelOrThrow(link.application_id);
    this.assertUploadAllowed(app);

    await this.storeDocumentVersion({
      applicationId: app.id,
      requirementId,
      file,
      uploadedByPublicSessionId: session.uploadLinkId,
    });

    if (app.status === 'needs_revision') {
      await this.db
        .updateTable('finance.financing_applications')
        .set({ status: 'collecting_requirements', updated_at: new Date() })
        .where('id', '=', app.id)
        .execute();
    }

    return { application: await this.getPublicApplicationResponse(app.id) };
  }

  async removePublicCurrentDocument(
    token: string,
    sessionToken: string | undefined,
    requirementId: string,
  ) {
    const link = await this.getActiveUploadLink(token);
    this.verifyPublicSession(sessionToken, link.application_id);
    const app = await this.getApplicationModelOrThrow(link.application_id);
    this.assertUploadAllowed(app);
    const requirement = await this.getRequirementOrThrow(app.id, requirementId);

    if (requirement.status === 'accepted') {
      throw new BadRequestException('Accepted requirements cannot be changed');
    }

    await this.db
      .updateTable('finance.financing_document_versions')
      .set({ is_current: false })
      .where('requirement_id', '=', requirementId)
      .where('is_current', '=', true)
      .execute();
    await this.db
      .updateTable('finance.financing_application_requirements')
      .set({ status: 'pending', updated_at: new Date() })
      .where('id', '=', requirementId)
      .execute();

    return { application: await this.getPublicApplicationResponse(app.id) };
  }

  async submitPublicRequirements(token: string, sessionToken: string | undefined) {
    const link = await this.getActiveUploadLink(token);
    this.verifyPublicSession(sessionToken, link.application_id);
    const app = await this.getApplicationModelOrThrow(link.application_id);
    this.assertUploadAllowed(app);
    await this.ensureRequiredDocumentsComplete(app.id);

    await this.db
      .updateTable('finance.financing_applications')
      .set({ status: 'under_review', updated_at: new Date() })
      .where('id', '=', app.id)
      .execute();
    await this.writeActivity(null, app.id, 'financing.requirements_submitted', `Requirements submitted for ${app.application_number}`);
    await this.notifyUsers([app.representative_user_id], {
      type: 'financing_requirements_submitted',
      title: 'Financing requirements submitted',
      message: `${app.application_number} is ready for review.`,
      entityId: app.id,
    });

    return { application: await this.getPublicApplicationResponse(app.id) };
  }

  async getDocumentDownloadUrl(
    user: CurrentUser,
    applicationId: string,
    documentId: string,
  ) {
    const app = await this.getApplicationModelOrThrow(applicationId);
    this.assertCanAccessApplication(user, app, PERMISSIONS.financingView);
    const document = await this.getDocumentOrThrow(applicationId, documentId);

    return {
      downloadUrl: this.cloudinaryStorageService.createSignedUrl(
        document.file_public_id,
        {
          resourceType: document.file_resource_type as 'image' | 'raw',
          expiresInSeconds: getFinancingDocumentUrlTtlSeconds(),
        },
      ),
    };
  }

  async getPublicDocumentDownloadUrl(
    token: string,
    sessionToken: string | undefined,
    documentId: string,
  ) {
    const link = await this.getActiveUploadLink(token);
    this.verifyPublicSession(sessionToken, link.application_id);
    const document = await this.getDocumentOrThrow(link.application_id, documentId);

    return {
      downloadUrl: this.cloudinaryStorageService.createSignedUrl(
        document.file_public_id,
        {
          resourceType: document.file_resource_type as 'image' | 'raw',
          expiresInSeconds: getFinancingDocumentUrlTtlSeconds(),
        },
      ),
    };
  }

  private buildApplicationListQuery(user: CurrentUser) {
    let query = this.db
      .selectFrom('finance.financing_applications as app')
      .innerJoin('crm.buyer_leads as buyer', 'buyer.id', 'app.buyer_lead_id')
      .innerJoin('inventory.vehicles as vehicle', 'vehicle.id', 'app.vehicle_id')
      .innerJoin('finance.financing_partners as partner', 'partner.id', 'app.partner_id')
      .innerJoin('authentication.users as rep', 'rep.id', 'app.representative_user_id')
      .innerJoin('authentication.users as staff', 'staff.id', 'app.assigned_staff_user_id');

    if (!hasAllPermission(user.permissions, PERMISSIONS.financingView)) {
      query = query.where((eb) =>
        eb.or([
          eb('app.assigned_staff_user_id', '=', user.id),
          eb('app.representative_user_id', '=', user.id),
        ]),
      );
    }

    return query;
  }

  private async getApplicationResponse(id: string) {
    const row = await this.buildApplicationListQuery(systemAllFinancingUser())
      .select(applicationSummarySelects)
      .where('app.id', '=', id)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException('Financing application was not found');
    }

    const [requirements, links, activities] = await Promise.all([
      this.getApplicationRequirements(id),
      this.getActiveLinks(id),
      this.activityHistoryService.listForEntity(
        'financing_application',
        id,
        systemAllFinancingUser(),
        { pageSize: 50 },
      ),
    ]);
    const progress = await this.getRequirementProgress([id]);

    return {
      ...mapApplicationSummary(row, progress.get(id) ?? defaultProgress()),
      requestedAmount: row.requested_amount,
      downPayment: row.down_payment,
      termMonths: row.term_months,
      decisionNote: row.decision_note,
      decidedAt: row.decided_at,
      releasedLoanAmount: row.released_loan_amount,
      loanReleasedAt: row.loan_released_at,
      loanReleaseReference: row.loan_release_reference,
      vehicleReleasedAt: row.vehicle_released_at,
      vehicleReleaseNote: row.vehicle_release_note,
      requirements,
      activeUploadLink: links[0] ?? null,
      activity: activities.events,
    };
  }

  private async getPublicApplicationResponse(id: string) {
    const app = await this.getApplicationResponse(id);
    return {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      requirements: app.requirements.map((requirement) => ({
        id: requirement.id,
        label: requirement.label,
        description: requirement.description,
        isRequired: requirement.isRequired,
        status: requirement.status,
        revisionReason: requirement.revisionReason,
        documents: requirement.documents
          .filter((document) => document.isCurrent)
          .map((document) => ({
            id: document.id,
            originalFilename: document.originalFilename,
            mimeType: document.mimeType,
            fileSize: document.fileSize,
            createdAt: document.createdAt,
          })),
      })),
    };
  }

  private async getApplicationRequirements(applicationId: string) {
    const requirements = await this.db
      .selectFrom('finance.financing_application_requirements')
      .selectAll()
      .where('application_id', '=', applicationId)
      .orderBy('sort_order')
      .execute();
    if (!requirements.length) {
      return [];
    }

    const documents = await this.db
      .selectFrom('finance.financing_document_versions')
      .selectAll()
      .where(
        'requirement_id',
        'in',
        requirements.map((requirement) => requirement.id),
      )
      .orderBy('version_number', 'desc')
      .execute();
    const documentsByRequirement = groupBy(documents, (document) => document.requirement_id);

    return requirements.map((requirement) => ({
      id: requirement.id,
      label: requirement.label,
      description: requirement.description,
      isRequired: requirement.is_required,
      sortOrder: requirement.sort_order,
      status: requirement.status as FinancingRequirementStatus,
      revisionReason: requirement.revision_reason,
      reviewNote: requirement.review_note,
      reviewedAt: requirement.reviewed_at,
      documents: (documentsByRequirement.get(requirement.id) ?? []).map((document) => ({
        id: document.id,
        versionNumber: document.version_number,
        originalFilename: document.original_filename,
        mimeType: document.mime_type,
        fileSize: document.file_size,
        isCurrent: document.is_current,
        createdAt: document.created_at,
      })),
    }));
  }

  private async getRequirementProgress(applicationIds: string[]) {
    if (!applicationIds.length) {
      return new Map<string, ReturnType<typeof defaultProgress>>();
    }

    const rows = await this.db
      .selectFrom('finance.financing_application_requirements')
      .select([
        'application_id',
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(*) filter (where status = 'accepted')::int`.as('accepted'),
        sql<number>`count(*) filter (where status in ('submitted', 'accepted'))::int`.as('submitted'),
      ])
      .where('application_id', 'in', applicationIds)
      .groupBy('application_id')
      .execute();

    return new Map(
      rows.map((row) => [
        row.application_id,
        {
          total: Number(row.total),
          submitted: Number(row.submitted),
          accepted: Number(row.accepted),
        },
      ]),
    );
  }

  private async getApplicationModelOrThrow(id: string) {
    const app = await this.db
      .selectFrom('finance.financing_applications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!app) {
      throw new NotFoundException('Financing application was not found');
    }

    return app;
  }

  private async getRequirementOrThrow(applicationId: string, requirementId: string) {
    const requirement = await this.db
      .selectFrom('finance.financing_application_requirements')
      .selectAll()
      .where('id', '=', requirementId)
      .where('application_id', '=', applicationId)
      .executeTakeFirst();

    if (!requirement) {
      throw new NotFoundException('Requirement was not found');
    }

    return requirement;
  }

  private async getDocumentOrThrow(applicationId: string, documentId: string) {
    const document = await this.db
      .selectFrom('finance.financing_document_versions as document')
      .innerJoin(
        'finance.financing_application_requirements as requirement',
        'requirement.id',
        'document.requirement_id',
      )
      .selectAll('document')
      .where('document.id', '=', documentId)
      .where('requirement.application_id', '=', applicationId)
      .executeTakeFirst();

    if (!document) {
      throw new NotFoundException('Document was not found');
    }

    return document;
  }

  private async getBuyerLeadOrThrow(id: string) {
    const buyerLead = await this.db
      .selectFrom('crm.buyer_leads')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!buyerLead) {
      throw new NotFoundException('Buyer lead was not found');
    }

    return buyerLead;
  }

  private async getVehicleOrThrow(id: string) {
    const vehicle = await this.db
      .selectFrom('inventory.vehicles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!vehicle) {
      throw new NotFoundException('Vehicle was not found');
    }

    return vehicle;
  }

  private async ensurePartnerExists(id: string) {
    const partner = await this.db
      .selectFrom('finance.financing_partners')
      .select(['id'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!partner) {
      throw new BadRequestException('Active financing partner was not found');
    }
  }

  private async ensureActiveUser(id: string) {
    const user = await this.db
      .selectFrom('authentication.users')
      .select(['id'])
      .where('id', '=', id)
      .where('active', '=', true)
      .executeTakeFirst();

    if (!user) {
      throw new BadRequestException('Active user was not found');
    }
  }

  private async ensureRepresentativeMembership(partnerId: string, userId: string) {
    const representative = await this.db
      .selectFrom('finance.financing_partner_representatives')
      .select(['id'])
      .where('partner_id', '=', partnerId)
      .where('user_id', '=', userId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!representative) {
      throw new BadRequestException('Representative must be active and belong to the selected partner');
    }
  }

  private async getDefaultTemplateId(partnerId: string) {
    const template = await this.db
      .selectFrom('finance.financing_requirement_templates')
      .select(['id'])
      .where('partner_id', '=', partnerId)
      .where('is_active', '=', true)
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    return template?.id ?? null;
  }

  private async getTemplateOrThrow(id: string) {
    const template = await this.db
      .selectFrom('finance.financing_requirement_templates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!template) {
      throw new NotFoundException('Requirement template was not found');
    }

    return template;
  }

  private async getTemplateResponse(id: string) {
    const template = await this.getTemplateOrThrow(id);
    const items = await this.db
      .selectFrom('finance.financing_requirement_template_items')
      .selectAll()
      .where('template_id', '=', id)
      .orderBy('sort_order')
      .execute();

    return mapTemplate(template, items);
  }

  private async clearDefaultTemplate(partnerId: string, trx: Transaction<DB>) {
    await trx
      .updateTable('finance.financing_requirement_templates')
      .set({ is_default: false, updated_at: new Date() })
      .where('partner_id', '=', partnerId)
      .where('is_default', '=', true)
      .execute();
  }

  private async replaceTemplateItems(
    templateId: string,
    items: { label: string; description?: string | null; isRequired?: boolean; sortOrder?: number }[],
    trx: Transaction<DB>,
  ) {
    await trx
      .deleteFrom('finance.financing_requirement_template_items')
      .where('template_id', '=', templateId)
      .execute();

    if (!items.length) {
      throw new BadRequestException('At least one template requirement is required');
    }

    await trx
      .insertInto('finance.financing_requirement_template_items')
      .values(
        items.map((item, index) => ({
          template_id: templateId,
          label: requireTrimmed(item.label, 'label'),
          description: normalizeOptionalTrimmed(item.description),
          is_required: item.isRequired ?? true,
          sort_order: item.sortOrder ?? index,
        })),
      )
      .execute();
  }

  private async copyTemplateRequirements(
    applicationId: string,
    templateId: string,
    trx: Transaction<DB>,
  ) {
    const items = await trx
      .selectFrom('finance.financing_requirement_template_items')
      .selectAll()
      .where('template_id', '=', templateId)
      .orderBy('sort_order')
      .execute();

    if (!items.length) {
      throw new BadRequestException('Selected template has no requirements');
    }

    await trx
      .insertInto('finance.financing_application_requirements')
      .values(
        items.map((item) => ({
          application_id: applicationId,
          template_item_id: item.id,
          label: item.label,
          description: item.description,
          is_required: item.is_required,
          sort_order: item.sort_order,
        })),
      )
      .execute();
  }

  private async allocateApplicationNumber(trx: Transaction<DB>) {
    const year = new Date().getUTCFullYear();
    await sql`select pg_advisory_xact_lock(${year + 200_000})`.execute(trx);
    const latest = await trx
      .selectFrom('finance.financing_applications')
      .select(['application_number'])
      .where('application_number', 'like', `FIN-${year}-%`)
      .orderBy(sql<number>`split_part(application_number, '-', 3)::integer`, 'desc')
      .executeTakeFirst();
    const sequence = latest?.application_number
      ? Number(latest.application_number.split('-').at(-1) ?? '0') + 1
      : 1;

    return `FIN-${year}-${String(sequence).padStart(4, '0')}`;
  }

  private assertCanAccessApplication(
    user: CurrentUser,
    app: {
      assigned_staff_user_id: string;
      representative_user_id: string;
    },
    permission: string,
  ) {
    if (hasAllPermission(user.permissions, permission)) {
      return;
    }

    if (
      user.permissions?.[permission] === 'assigned' &&
      (app.assigned_staff_user_id === user.id ||
        app.representative_user_id === user.id)
    ) {
      return;
    }

    throw new ForbiddenException('You do not have access to this financing application');
  }

  private assertNotTerminal(app: { status: string }) {
    if (TERMINAL_APPLICATION_STATUSES.includes(app.status as FinancingApplicationStatus)) {
      throw new BadRequestException('Terminal applications cannot be changed');
    }
  }

  private assertUploadAllowed(app: { status: string }) {
    if (!['collecting_requirements', 'needs_revision'].includes(app.status)) {
      throw new BadRequestException('Documents cannot be uploaded in the current status');
    }
  }

  private async ensureRequiredDocumentsComplete(applicationId: string) {
    const missing = await this.db
      .selectFrom('finance.financing_application_requirements as requirement')
      .leftJoin('finance.financing_document_versions as document', (join) =>
        join
          .onRef('document.requirement_id', '=', 'requirement.id')
          .on('document.is_current', '=', true),
      )
      .select(['requirement.id'])
      .where('requirement.application_id', '=', applicationId)
      .where('requirement.is_required', '=', true)
      .where('document.id', 'is', null)
      .executeTakeFirst();

    if (missing) {
      throw new BadRequestException('All required documents must be uploaded before submission');
    }

    await this.db
      .updateTable('finance.financing_application_requirements')
      .set({ status: 'submitted', updated_at: new Date() })
      .where('application_id', '=', applicationId)
      .where('status', 'in', ['pending', 'revision_requested'])
      .execute();
  }

  private async ensureAllRequiredAccepted(applicationId: string) {
    const notAccepted = await this.db
      .selectFrom('finance.financing_application_requirements')
      .select(['id'])
      .where('application_id', '=', applicationId)
      .where('is_required', '=', true)
      .where('status', '!=', 'accepted')
      .executeTakeFirst();

    if (notAccepted) {
      throw new BadRequestException('All required items must be accepted before approval');
    }
  }

  private async storeDocumentVersion(input: {
    applicationId: string;
    requirementId: string;
    file: UploadedFinancingFile;
    uploadedByUserId?: string;
    uploadedByPublicSessionId?: string;
  }) {
    if (
      !isAllowedFinancingDocument({
        mimeType: input.file.mimetype,
        size: input.file.size,
      })
    ) {
      throw new BadRequestException('Only PDF, JPG, PNG, and WEBP files up to 10 MB are allowed');
    }

    const requirement = await this.getRequirementOrThrow(
      input.applicationId,
      input.requirementId,
    );

    if (requirement.status === 'accepted') {
      throw new BadRequestException('Accepted requirements cannot be changed');
    }

    const currentCount = await this.db
      .selectFrom('finance.financing_document_versions')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('requirement_id', '=', input.requirementId)
      .where('is_current', '=', true)
      .executeTakeFirstOrThrow();

    if (Number(currentCount.count) >= 5) {
      throw new BadRequestException('A requirement can have up to five current files');
    }

    const storedFile = await this.cloudinaryStorageService.savePrivateUserFile({
      userId: input.uploadedByUserId ?? 'public',
      buffer: input.file.buffer,
      mimeType: input.file.mimetype,
      originalName: input.file.originalname,
      folder: `etc-cars/financing/${input.applicationId}/${input.requirementId}`,
      resourceType: input.file.mimetype.startsWith('image/') ? 'image' : 'raw',
    });
    const latest = await this.db
      .selectFrom('finance.financing_document_versions')
      .select(sql<number>`coalesce(max(version_number), 0)::int`.as('version'))
      .where('requirement_id', '=', input.requirementId)
      .executeTakeFirstOrThrow();

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('finance.financing_document_versions')
        .set({ is_current: false })
        .where('requirement_id', '=', input.requirementId)
        .where('is_current', '=', true)
        .execute();
      await trx
        .insertInto('finance.financing_document_versions')
        .values({
          requirement_id: input.requirementId,
          version_number: Number(latest.version) + 1,
          file_public_id: storedFile.publicId ?? storedFile.relativePath,
          file_resource_type: input.file.mimetype.startsWith('image/') ? 'image' : 'raw',
          original_filename: input.file.originalname,
          mime_type: input.file.mimetype,
          file_size: input.file.size,
          uploaded_by_user_id: input.uploadedByUserId ?? null,
          uploaded_by_public_session_id: input.uploadedByPublicSessionId ?? null,
        })
        .execute();
      await trx
        .updateTable('finance.financing_application_requirements')
        .set({ status: 'submitted', revision_reason: null, updated_at: new Date() })
        .where('id', '=', input.requirementId)
        .execute();
    });
  }

  private async getActiveUploadLink(rawToken: string) {
    const link = await this.db
      .selectFrom('finance.financing_upload_links')
      .selectAll()
      .where('token_hash', '=', hashUploadToken(rawToken))
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    if (!link) {
      throw new ForbiddenException('Invalid or expired upload link');
    }

    return link;
  }

  private async enforceVerificationRateLimit(linkId: string, ipAddress: string) {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const row = await this.db
      .selectFrom('finance.financing_upload_verification_attempts')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('upload_link_id', '=', linkId)
      .where('ip_address', '=', ipAddress)
      .where('succeeded', '=', false)
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow();

    if (Number(row.count) >= 5) {
      throw new ForbiddenException('Invalid or expired upload link');
    }
  }

  private verifyPublicSession(
    sessionToken: string | undefined,
    applicationId: string,
  ) {
    const session = verifyUploadSessionToken(sessionToken, {
      secret: getFinancingUploadSessionSecret(),
      applicationId,
    });

    if (!session) {
      throw new ForbiddenException('Invalid or expired upload session');
    }

    return session;
  }

  private async getActiveLinks(applicationId: string) {
    return this.db
      .selectFrom('finance.financing_upload_links')
      .select(['id', 'expires_at', 'revoked_at', 'created_at'])
      .where('application_id', '=', applicationId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
  }

  private async notifyUsers(
    userIds: (string | null | undefined)[],
    notification: { type: string; title: string; message: string; entityId: string },
  ) {
    const recipients = Array.from(new Set(userIds.filter(Boolean))) as string[];
    if (!recipients.length) {
      return;
    }

    await this.db
      .insertInto('ops.notifications')
      .values(
        recipients.map((recipientId) => ({
          recipient_user_id: recipientId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          entity_type: 'financing_application',
          entity_id: notification.entityId,
          deduplication_key: `${notification.type}:${notification.entityId}:${recipientId}:${Date.now()}`,
        })),
      )
      .execute();
  }

  private async writeActivity(
    user: CurrentUser | null,
    applicationId: string,
    actionType: string,
    summary: string,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    await this.activityHistoryService.write(
      {
        actor: user,
        entityType: 'financing_application',
        entityId: applicationId,
        actionType,
        summary,
      },
      executor,
    );
  }
}

function mapPartner(row: any, representatives: ReturnType<typeof mapRepresentativeDetail>[] = []) {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    contactNumber: row.contact_number,
    email: row.email,
    notes: row.notes,
    isActive: row.is_active,
    representatives,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRepresentative(row: any) {
  return {
    id: row.id,
    partnerId: row.partner_id,
    userId: row.user_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRepresentativeDetail(row: any) {
  return {
    id: row.id,
    partnerId: row.partnerId,
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    roleName: row.roleName,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTemplate(template: any, items: any[]) {
  return {
    id: template.id,
    partnerId: template.partner_id,
    name: template.name,
    description: template.description,
    isDefault: template.is_default,
    isActive: template.is_active,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      isRequired: item.is_required,
      sortOrder: item.sort_order,
    })),
  };
}

function mapApplicationSummary(row: any, progress: ReturnType<typeof defaultProgress>) {
  return {
    id: row.id,
    applicationNumber: row.application_number,
    buyerLeadId: row.buyer_lead_id,
    vehicleId: row.vehicle_id,
    partnerId: row.partner_id,
    representativeUserId: row.representative_user_id,
    assignedStaffUserId: row.assigned_staff_user_id,
    status: row.status as FinancingApplicationStatus,
    buyer: {
      id: row.buyer_lead_id,
      name: row.buyer_name,
      contactNumber: row.buyer_contact_number,
    },
    vehicle: {
      id: row.vehicle_id,
      stockNumber: row.vehicle_stock_number,
      label: [row.vehicle_year, row.vehicle_brand, row.vehicle_model, row.vehicle_variant]
        .filter(Boolean)
        .join(' '),
    },
    partner: {
      id: row.partner_id,
      name: row.partner_name,
    },
    representative: {
      id: row.representative_user_id,
      name: row.representative_full_name,
    },
    assignedStaff: {
      id: row.assigned_staff_user_id,
      name: row.assigned_staff_full_name,
    },
    requirementProgress: progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultProgress() {
  return { total: 0, submitted: 0, accepted: 0 };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

function requireTrimmed(value: string | null | undefined, field: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }
  return trimmed;
}

function normalizeOptionalTrimmed(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function parseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date');
  }
  return date;
}

function systemAllFinancingUser(): CurrentUser {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'system@etc-cars.local',
    fullName: 'System',
    role: 'admin',
    roleId: '00000000-0000-0000-0000-000000000000',
    roleName: 'Administrator',
    isAdministrator: true,
    permissions: { [PERMISSIONS.financingView]: 'all' },
    mustChangePassword: false,
    active: true,
  };
}
