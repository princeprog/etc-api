import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Kysely, type Transaction } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import type {
  CreateInspectionTemplateDto,
  UpdateInspectionChecklistSettingsDto,
  InspectionTemplateSectionDto,
  UpdateInspectionTemplateDraftDto,
} from './dto/inspection-template.dto';
import type { UpdateSellerLeadInspectionDto } from './dto/seller-lead-inspection.dto';

type Rating = 'good' | 'fair' | 'poor';
type InspectionAnswer = { rating: Rating | null; notes: string | null };
type InspectionAnswers = Record<string, InspectionAnswer>;
type TemplateSnapshot = {
  templateName: string;
  versionNumber: number;
  sections: Array<{
    id: string;
    label: string;
    sortOrder: number;
    isActive: boolean;
    items: Array<{
      id: string;
      stableKey: string;
      label: string;
      findingKey: string | null;
      isRequired: boolean;
      isActive: boolean;
      sortOrder: number;
    }>;
  }>;
};

const VALID_RATINGS = ['good', 'fair', 'poor'] as const;
const VALID_FINDING_KEYS = [
  'engine',
  'transmission',
  'suspension',
  'brakes',
  'tires',
  'exterior',
  'interior',
  'ac',
  'electrical',
  'papers',
] as const;

@Injectable()
export class InspectionChecklistsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<any>,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async getChecklistSettings() {
    const template = await this.getSingletonTemplate();
    const version = await this.getLatestPublishedVersion(template.id);
    const draftCount = await this.getDraftInspectionCount();

    if (!version) {
      return {
        id: template.id,
        revision: 0,
        sections: [],
        updatedAt: template.updated_at,
        updatedBy: await this.getUserSummary(template.updated_by_user_id),
        affectedDraftInspectionCount: draftCount,
      };
    }

    return {
      id: template.id,
      revision: version.version_number,
      sections: await this.getVersionSections(version.id),
      updatedAt: template.updated_at,
      updatedBy: await this.getUserSummary(template.updated_by_user_id),
      affectedDraftInspectionCount: draftCount,
    };
  }

  async updateChecklistSettings(
    user: CurrentUser,
    dto: UpdateInspectionChecklistSettingsDto,
  ) {
    const result = await this.db.transaction().execute(async (trx) => {
      const template = await this.getSingletonTemplate(trx);
      const currentVersion = await this.getLatestPublishedVersion(
        template.id,
        trx,
      );
      const currentRevision = Number(currentVersion?.version_number ?? 0);

      if (
        dto.expectedRevision !== undefined &&
        Number(dto.expectedRevision) !== currentRevision
      ) {
        throw new ConflictException(
          'The inspection checklist was updated by another user. Reload before saving.',
        );
      }

      const sections = this.normalizeSections(dto.sections ?? []);
      this.ensurePublishable(sections);
      const nextRevision = currentRevision + 1;
      const now = new Date();

      await trx
        .updateTable('crm.inspection_template_versions')
        .set({ status: 'published', updated_at: now })
        .where('template_id', '=', template.id)
        .where('status', '=', 'draft')
        .execute();

      const version = await trx
        .insertInto('crm.inspection_template_versions')
        .values({
          template_id: template.id,
          version_number: nextRevision,
          status: 'published',
          published_at: now,
          published_by_user_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.replaceVersionStructure(trx, version.id, sections);

      await trx
        .updateTable('crm.inspection_templates')
        .set({
          name: 'Vehicle Inspection Checklist',
          description: 'Single dealership-wide vehicle inspection checklist.',
          is_default: true,
          archived_at: null,
          updated_by_user_id: user.id,
          updated_at: now,
        })
        .where('id', '=', template.id)
        .execute();

      const snapshot = await this.buildTemplateSnapshot(version.id, trx);
      const affectedDraftInspectionCount = await this.syncDraftInspections(
        trx,
        version.id,
        snapshot,
      );

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'seller_lead',
          entityId: template.id,
          actionType: 'inspection_checklist.settings_updated',
          summary: `Inspection checklist updated to revision ${nextRevision}`,
          metadata: {
            revision: nextRevision,
            affectedDraftInspectionCount,
          },
        },
        trx as any,
      );

      return {
        revision: nextRevision,
        updatedAt: now,
        affectedDraftInspectionCount,
        sections: await this.getVersionSections(version.id, trx),
      };
    });

    return {
      ...result,
      updatedBy: {
        id: user.id,
        fullName: user.fullName ?? null,
      },
    };
  }

  async listTemplates() {
    const templates = await this.db
      .selectFrom('crm.inspection_templates')
      .selectAll()
      .orderBy('is_default', 'desc')
      .orderBy('updated_at', 'desc')
      .execute();

    const items = await Promise.all(
      templates.map(async (template) => ({
        ...this.mapTemplate(template),
        draftVersion: await this.getVersionSummary(template.id, 'draft'),
        latestPublishedVersion: await this.getVersionSummary(
          template.id,
          'published',
        ),
      })),
    );

    return { templates: items };
  }

  async listPublishedTemplates() {
    const versions = await this.db
      .selectFrom('crm.inspection_template_versions as version')
      .innerJoin(
        'crm.inspection_templates as template',
        'template.id',
        'version.template_id',
      )
      .select([
        'version.id as id',
        'version.version_number as versionNumber',
        'version.published_at as publishedAt',
        'template.id as templateId',
        'template.name as name',
        'template.description as description',
        'template.is_default as isDefault',
      ])
      .where('version.status', '=', 'published')
      .where('template.archived_at', 'is', null)
      .orderBy('template.is_default', 'desc')
      .orderBy('template.name', 'asc')
      .execute();

    return { templates: versions.map((version) => this.mapPublished(version)) };
  }

  async getTemplate(id: string) {
    const template = await this.getTemplateOrThrow(id);
    const versions = await this.db
      .selectFrom('crm.inspection_template_versions')
      .selectAll()
      .where('template_id', '=', id)
      .orderBy('status', 'asc')
      .orderBy('version_number', 'desc')
      .execute();

    return {
      template: this.mapTemplate(template),
      versions: await Promise.all(
        versions.map(async (version) => this.mapVersionWithStructure(version)),
      ),
    };
  }

  async createTemplate(user: CurrentUser, dto: CreateInspectionTemplateDto) {
    const templateId = await this.db.transaction().execute(async (trx) => {
      const name = this.requireText(dto.name, 'name');
      const template = await trx
        .insertInto('crm.inspection_templates')
        .values({
          name,
          description: this.optionalText(dto.description),
          created_by_user_id: user.id,
          updated_by_user_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const draft = await trx
        .insertInto('crm.inspection_template_versions')
        .values({
          template_id: template.id,
          version_number: 0,
          status: 'draft',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const sections = dto.sourceVersionId
        ? await this.copyVersionStructure(trx, dto.sourceVersionId)
        : this.normalizeSections(dto.sections ?? []);
      await this.replaceVersionStructure(trx, draft.id, sections);

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'seller_lead',
          entityId: template.id,
          actionType: 'inspection_template.created',
          summary: 'Inspection checklist template created',
          metadata: { name },
        },
        trx as any,
      );

      return template.id;
    });

    return this.getTemplate(templateId);
  }

  async updateDraft(
    user: CurrentUser,
    id: string,
    dto: UpdateInspectionTemplateDraftDto,
  ) {
    const templateId = await this.db.transaction().execute(async (trx) => {
      const template = await this.getTemplateOrThrow(id, trx);
      if (template.archived_at) {
        throw new BadRequestException('Archived templates cannot be edited');
      }

      if (dto.name !== undefined || dto.description !== undefined) {
        await trx
          .updateTable('crm.inspection_templates')
          .set({
            ...(dto.name !== undefined
              ? { name: this.requireText(dto.name, 'name') }
              : {}),
            ...(dto.description !== undefined
              ? { description: this.optionalText(dto.description) }
              : {}),
            updated_by_user_id: user.id,
            updated_at: new Date(),
          })
          .where('id', '=', id)
          .execute();
      }

      const draft = await this.ensureDraftVersion(trx, id);
      if (dto.sections !== undefined) {
        await this.replaceVersionStructure(
          trx,
          draft.id,
          this.normalizeSections(dto.sections),
        );
      }

      return id;
    });

    return this.getTemplate(templateId);
  }

  async publishTemplate(user: CurrentUser, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const template = await this.getTemplateOrThrow(id, trx);
      if (template.archived_at) {
        throw new BadRequestException('Archived templates cannot be published');
      }
      const draft = await this.getDraftVersionOrThrow(id, trx);
      const sections = await this.getVersionSections(draft.id, trx);
      this.ensurePublishable(sections);
      const nextVersion = await this.getNextVersionNumber(id, trx);

      const published = await trx
        .updateTable('crm.inspection_template_versions')
        .set({
          status: 'published',
          version_number: nextVersion,
          published_at: new Date(),
          published_by_user_id: user.id,
          updated_at: new Date(),
        })
        .where('id', '=', draft.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('crm.inspection_templates')
        .set({ updated_by_user_id: user.id, updated_at: new Date() })
        .where('id', '=', id)
        .execute();

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'seller_lead',
          entityId: id,
          actionType: 'inspection_template.published',
          summary: `Inspection checklist published as v${nextVersion}`,
          metadata: { templateName: template.name, version: nextVersion },
        },
        trx as any,
      );

      return { version: await this.mapVersionWithStructure(published, trx) };
    });
  }

  async setDefaultTemplate(user: CurrentUser, id: string) {
    await this.ensureTemplateHasPublishedVersion(id);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('crm.inspection_templates')
        .set({ is_default: false, updated_at: new Date() })
        .where('is_default', '=', true)
        .execute();
      await trx
        .updateTable('crm.inspection_templates')
        .set({
          is_default: true,
          archived_at: null,
          updated_by_user_id: user.id,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
    });

    return this.getTemplate(id);
  }

  async archiveTemplate(user: CurrentUser, id: string) {
    const template = await this.getTemplateOrThrow(id);
    if (template.is_default) {
      throw new BadRequestException('Set another default before archiving');
    }
    await this.db
      .updateTable('crm.inspection_templates')
      .set({
        archived_at: new Date(),
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return this.getTemplate(id);
  }

  async restoreTemplate(user: CurrentUser, id: string) {
    await this.db
      .updateTable('crm.inspection_templates')
      .set({
        archived_at: null,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return this.getTemplate(id);
  }

  async getSellerLeadInspection(sellerLeadId: string) {
    const inspection = await this.db.transaction().execute(async (trx) => {
      await this.ensureSellerLeadExists(sellerLeadId, trx);
      const existing = await trx
        .selectFrom('crm.seller_lead_inspections')
        .selectAll()
        .where('seller_lead_id', '=', sellerLeadId)
        .executeTakeFirst();

      if (!existing || existing.status !== 'draft') return existing;
      return this.syncDraftInspectionToCurrentVersion(existing, trx);
    });

    return {
      inspection: inspection ? this.mapInspection(inspection) : null,
    };
  }

  async startSellerLeadInspection(user: CurrentUser, sellerLeadId: string) {
    return this.db.transaction().execute(async (trx) => {
      await this.ensureSellerLeadExists(sellerLeadId, trx);
      const existing = await trx
        .selectFrom('crm.seller_lead_inspections')
        .selectAll()
        .where('seller_lead_id', '=', sellerLeadId)
        .executeTakeFirst();
      if (existing) return { inspection: this.mapInspection(existing) };

      const version = await this.getDefaultPublishedVersion(trx);
      const snapshot = await this.buildTemplateSnapshot(version.id, trx);
      const inspection = await trx
        .insertInto('crm.seller_lead_inspections')
        .values({
          seller_lead_id: sellerLeadId,
          template_version_id: version.id,
          template_snapshot: snapshot,
          answers: {},
          overall_condition: 'fair',
          status: 'draft',
          inspector_user_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { inspection: this.mapInspection(inspection) };
    });
  }

  async updateSellerLeadInspection(
    user: CurrentUser,
    sellerLeadId: string,
    dto: UpdateSellerLeadInspectionDto,
  ) {
    const existing = await this.getInspectionOrThrow(sellerLeadId);
    if (existing.status === 'completed') {
      throw new BadRequestException('Completed inspections are read-only');
    }

    const answers = this.normalizeAnswers(dto.answers ?? existing.answers);
    const overallCondition =
      dto.overallCondition ?? this.calculateOverallCondition(answers);
    const update: Record<string, unknown> = {
      answers,
      overall_condition: overallCondition,
      inspector_user_id: user.id,
      updated_at: new Date(),
    };

    if (dto.majorIssues !== undefined) {
      update.major_issues = this.optionalText(dto.majorIssues);
    }
    if (dto.recommendedRepairs !== undefined) {
      update.recommended_repairs = this.optionalText(dto.recommendedRepairs);
    }
    if (dto.inspectorNotes !== undefined) {
      update.inspector_notes = this.optionalText(dto.inspectorNotes);
    }
    if (dto.estimatedRepairCost !== undefined) {
      update.estimated_repair_cost = this.normalizeMoney(
        dto.estimatedRepairCost,
      );
    }

    await this.db
      .updateTable('crm.seller_lead_inspections')
      .set(update)
      .where('id', '=', existing.id)
      .execute();

    return this.getSellerLeadInspection(sellerLeadId);
  }

  async completeSellerLeadInspection(user: CurrentUser, sellerLeadId: string) {
    return this.db.transaction().execute(async (trx) => {
      const existing = await this.getInspectionOrThrow(sellerLeadId, trx);
      if (existing.status === 'completed') {
        return { inspection: this.mapInspection(existing) };
      }

      const answers = this.normalizeAnswers(existing.answers);
      const snapshot = existing.template_snapshot as TemplateSnapshot;
      const missing = this.getMissingRequiredItems(snapshot, answers);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Complete required checklist items: ${missing.join(', ')}`,
        );
      }

      const completedAt = new Date();
      const overallCondition = this.calculateOverallCondition(answers);
      const findings = this.aggregateFindings(snapshot, answers);
      const notes = this.buildLegacyInspectionNotes(existing);
      const sellerLead = await this.getSellerLeadOrThrow(sellerLeadId, trx);
      const nextStatus = ['Approved to Buy', 'Purchased', 'Rejected'].includes(
        sellerLead.status,
      )
        ? sellerLead.status
        : 'Evaluated';

      const inspection = await trx
        .updateTable('crm.seller_lead_inspections')
        .set({
          status: 'completed',
          completed_at: completedAt,
          overall_condition: overallCondition,
          inspector_user_id: user.id,
          updated_at: completedAt,
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('crm.seller_leads')
        .set({
          inspection_completed_at: completedAt,
          inspection_notes: notes,
          inspection_findings: findings,
          status: nextStatus,
          updated_at: completedAt,
        })
        .where('id', '=', sellerLeadId)
        .execute();

      await this.activityHistoryService.write(
        {
          actor: user,
          entityType: 'seller_lead',
          entityId: sellerLeadId,
          actionType: 'seller_lead.inspection_completed',
          summary: 'Seller lead inspection completed',
          metadata: { overallCondition, nextStatus },
        },
        trx as any,
      );

      return { inspection: this.mapInspection(inspection) };
    });
  }

  private async syncDraftInspections(
    trx: Transaction<any>,
    templateVersionId: string,
    snapshot: TemplateSnapshot,
  ) {
    const inspections = await trx
      .selectFrom('crm.seller_lead_inspections')
      .selectAll()
      .where('status', '=', 'draft')
      .execute();

    for (const inspection of inspections) {
      await trx
        .updateTable('crm.seller_lead_inspections')
        .set({
          template_version_id: templateVersionId,
          template_snapshot: snapshot,
          answers: this.remapAnswersToSnapshot(
            inspection.template_snapshot as TemplateSnapshot,
            this.normalizeAnswers(inspection.answers),
            snapshot,
          ),
          updated_at: new Date(),
        })
        .where('id', '=', inspection.id)
        .execute();
    }

    return inspections.length;
  }

  private async syncDraftInspectionToCurrentVersion(
    inspection: any,
    trx: Transaction<any>,
  ) {
    const version = await this.getDefaultPublishedVersion(trx);
    if (inspection.template_version_id === version.id) return inspection;

    const snapshot = await this.buildTemplateSnapshot(version.id, trx);
    return trx
      .updateTable('crm.seller_lead_inspections')
      .set({
        template_version_id: version.id,
        template_snapshot: snapshot,
        answers: this.remapAnswersToSnapshot(
          inspection.template_snapshot as TemplateSnapshot,
          this.normalizeAnswers(inspection.answers),
          snapshot,
        ),
        updated_at: new Date(),
      })
      .where('id', '=', inspection.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private remapAnswersToSnapshot(
    oldSnapshot: TemplateSnapshot | null | undefined,
    oldAnswers: InspectionAnswers,
    newSnapshot: TemplateSnapshot,
  ) {
    const answersByStableKey = new Map<string, InspectionAnswer>();
    const oldItems = (oldSnapshot?.sections ?? []).flatMap(
      (section) => section.items ?? [],
    );

    for (const item of oldItems) {
      const answer = oldAnswers[item.id];
      if (answer) answersByStableKey.set(item.stableKey, answer);
    }

    const nextAnswers: InspectionAnswers = {};
    for (const item of newSnapshot.sections.flatMap(
      (section) => section.items,
    )) {
      if (!item.isActive) continue;
      const answer = answersByStableKey.get(item.stableKey);
      if (answer) nextAnswers[item.id] = answer;
    }

    return nextAnswers;
  }

  private async getSingletonTemplate(executor = this.db) {
    const existingDefault = await executor
      .selectFrom('crm.inspection_templates')
      .selectAll()
      .where('is_default', '=', true)
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    if (existingDefault) return existingDefault;

    const existing = await executor
      .selectFrom('crm.inspection_templates')
      .selectAll()
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    if (existing) {
      await executor
        .updateTable('crm.inspection_templates')
        .set({ is_default: true, archived_at: null, updated_at: new Date() })
        .where('id', '=', existing.id)
        .execute();
      return { ...existing, is_default: true, archived_at: null };
    }

    return executor
      .insertInto('crm.inspection_templates')
      .values({
        name: 'Vehicle Inspection Checklist',
        description: 'Single dealership-wide vehicle inspection checklist.',
        is_default: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async getDraftInspectionCount() {
    const row = await this.db
      .selectFrom('crm.seller_lead_inspections')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('status', '=', 'draft')
      .executeTakeFirstOrThrow();
    return Number(row.count ?? 0);
  }

  private async getUserSummary(userId: string | null) {
    if (!userId) return null;
    const user = await this.db
      .selectFrom('authentication.users')
      .select(['id', 'full_name as fullName'])
      .where('id', '=', userId)
      .executeTakeFirst();
    return user ?? { id: userId, fullName: null };
  }

  private async ensureDraftVersion(trx: Transaction<any>, templateId: string) {
    const existing = await trx
      .selectFrom('crm.inspection_template_versions')
      .selectAll()
      .where('template_id', '=', templateId)
      .where('status', '=', 'draft')
      .executeTakeFirst();
    if (existing) return existing;

    const draft = await trx
      .insertInto('crm.inspection_template_versions')
      .values({ template_id: templateId, version_number: 0, status: 'draft' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const published = await this.getLatestPublishedVersion(templateId, trx);
    if (published) {
      const sections = await this.getVersionSections(published.id, trx);
      await this.replaceVersionStructure(trx, draft.id, sections);
    }
    return draft;
  }

  private async replaceVersionStructure(
    trx: Transaction<any>,
    versionId: string,
    sections: InspectionTemplateSectionDto[],
  ) {
    await trx
      .deleteFrom('crm.inspection_template_sections')
      .where('template_version_id', '=', versionId)
      .execute();

    for (const section of sections) {
      const insertedSection = await trx
        .insertInto('crm.inspection_template_sections')
        .values({
          template_version_id: versionId,
          label: this.requireText(section.label, 'section label'),
          sort_order: section.sortOrder ?? 0,
          is_active: section.isActive ?? true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const item of section.items ?? []) {
        await trx
          .insertInto('crm.inspection_template_items')
          .values({
            template_section_id: insertedSection.id,
            stable_key: item.stableKey ?? this.slugify(item.label ?? ''),
            label: this.requireText(item.label, 'item label'),
            finding_key: this.normalizeFindingKey(item.findingKey),
            is_required: item.isRequired ?? true,
            is_active: item.isActive ?? true,
            sort_order: item.sortOrder ?? 0,
          })
          .execute();
      }
    }
  }

  private async copyVersionStructure(trx: Transaction<any>, versionId: string) {
    const version = await trx
      .selectFrom('crm.inspection_template_versions')
      .select('id')
      .where('id', '=', versionId)
      .executeTakeFirst();
    if (!version) throw new NotFoundException('Source version was not found');
    return this.getVersionSections(versionId, trx);
  }

  private async getVersionSections(versionId: string, executor = this.db) {
    const rows = await executor
      .selectFrom('crm.inspection_template_sections as section')
      .leftJoin(
        'crm.inspection_template_items as item',
        'item.template_section_id',
        'section.id',
      )
      .select([
        'section.id as sectionId',
        'section.label as sectionLabel',
        'section.sort_order as sectionSortOrder',
        'section.is_active as sectionIsActive',
        'item.id as itemId',
        'item.stable_key as stableKey',
        'item.label as itemLabel',
        'item.finding_key as findingKey',
        'item.is_required as itemIsRequired',
        'item.is_active as itemIsActive',
        'item.sort_order as itemSortOrder',
      ])
      .where('section.template_version_id', '=', versionId)
      .orderBy('section.sort_order', 'asc')
      .orderBy('item.sort_order', 'asc')
      .execute();

    const bySection = new Map<string, InspectionTemplateSectionDto>();
    for (const row of rows) {
      if (!bySection.has(row.sectionId)) {
        bySection.set(row.sectionId, {
          id: row.sectionId,
          label: row.sectionLabel,
          isActive: row.sectionIsActive,
          sortOrder: row.sectionSortOrder,
          items: [],
        });
      }
      if (row.itemId) {
        bySection.get(row.sectionId)!.items!.push({
          id: row.itemId,
          stableKey: row.stableKey,
          label: row.itemLabel,
          findingKey: row.findingKey,
          isRequired: row.itemIsRequired,
          isActive: row.itemIsActive,
          sortOrder: row.itemSortOrder,
        });
      }
    }
    return [...bySection.values()];
  }

  private async mapVersionWithStructure(version: any, executor = this.db) {
    return {
      id: version.id,
      templateId: version.template_id,
      versionNumber: version.version_number,
      status: version.status,
      publishedAt: version.published_at,
      sections: await this.getVersionSections(version.id, executor),
    };
  }

  private async buildTemplateSnapshot(
    versionId: string,
    executor = this.db,
  ): Promise<TemplateSnapshot> {
    const version = await executor
      .selectFrom('crm.inspection_template_versions as version')
      .innerJoin(
        'crm.inspection_templates as template',
        'template.id',
        'version.template_id',
      )
      .select([
        'version.id',
        'version.version_number as versionNumber',
        'template.name as templateName',
      ])
      .where('version.id', '=', versionId)
      .executeTakeFirstOrThrow();
    const sections = (await this.getVersionSections(versionId, executor)).map(
      (section) => ({
        id: this.requireText(section.id, 'section id'),
        label: this.requireText(section.label, 'section label'),
        sortOrder: section.sortOrder ?? 0,
        isActive: section.isActive ?? true,
        items: (section.items ?? []).map((item) => ({
          id: this.requireText(item.id, 'item id'),
          stableKey: this.requireText(item.stableKey, 'item stable key'),
          label: this.requireText(item.label, 'item label'),
          findingKey: this.normalizeFindingKey(item.findingKey),
          isRequired: item.isRequired ?? true,
          isActive: item.isActive ?? true,
          sortOrder: item.sortOrder ?? 0,
        })),
      }),
    );

    return {
      templateName: version.templateName,
      versionNumber: version.versionNumber,
      sections,
    };
  }

  private async getVersionSummary(templateId: string, status: string) {
    const version = await this.db
      .selectFrom('crm.inspection_template_versions')
      .selectAll()
      .where('template_id', '=', templateId)
      .where('status', '=', status)
      .orderBy('version_number', 'desc')
      .executeTakeFirst();

    return version
      ? {
          id: version.id,
          versionNumber: version.version_number,
          status: version.status,
          publishedAt: version.published_at,
        }
      : null;
  }

  private async getTemplateOrThrow(id: string, executor = this.db) {
    const template = await executor
      .selectFrom('crm.inspection_templates')
      .selectAll()
      .where('id', '=', this.requireText(id, 'id'))
      .executeTakeFirst();
    if (!template) throw new NotFoundException(`Template ${id} was not found`);
    return template;
  }

  private async getDraftVersionOrThrow(templateId: string, executor = this.db) {
    const version = await executor
      .selectFrom('crm.inspection_template_versions')
      .selectAll()
      .where('template_id', '=', templateId)
      .where('status', '=', 'draft')
      .executeTakeFirst();
    if (!version) throw new BadRequestException('No draft to publish');
    return version;
  }

  private async getLatestPublishedVersion(
    templateId: string,
    executor = this.db,
  ) {
    return executor
      .selectFrom('crm.inspection_template_versions')
      .selectAll()
      .where('template_id', '=', templateId)
      .where('status', '=', 'published')
      .orderBy('version_number', 'desc')
      .executeTakeFirst();
  }

  private async getPublishedVersionOrThrow(
    versionId: string,
    executor = this.db,
  ) {
    const version = await executor
      .selectFrom('crm.inspection_template_versions')
      .selectAll()
      .where('id', '=', versionId)
      .where('status', '=', 'published')
      .executeTakeFirst();
    if (!version)
      throw new NotFoundException('Published template was not found');
    return version;
  }

  private async getDefaultPublishedVersion(executor = this.db) {
    const version = await executor
      .selectFrom('crm.inspection_template_versions as version')
      .innerJoin(
        'crm.inspection_templates as template',
        'template.id',
        'version.template_id',
      )
      .select('version.id')
      .where('version.status', '=', 'published')
      .where('template.is_default', '=', true)
      .where('template.archived_at', 'is', null)
      .orderBy('version.version_number', 'desc')
      .orderBy('version.published_at', 'desc')
      .executeTakeFirst();
    if (!version)
      throw new BadRequestException('No default inspection template');
    return this.getPublishedVersionOrThrow(version.id, executor);
  }

  private async getNextVersionNumber(templateId: string, executor = this.db) {
    const row = await executor
      .selectFrom('crm.inspection_template_versions')
      .select(({ fn }) => fn.max<number>('version_number').as('maxVersion'))
      .where('template_id', '=', templateId)
      .where('status', '=', 'published')
      .executeTakeFirstOrThrow();
    return Number(row.maxVersion ?? 0) + 1;
  }

  private async ensureTemplateHasPublishedVersion(id: string) {
    const version = await this.getLatestPublishedVersion(id);
    if (!version) {
      throw new BadRequestException(
        'Publish the template before setting default',
      );
    }
  }

  private async ensureSellerLeadExists(
    sellerLeadId: string,
    executor = this.db,
  ) {
    await this.getSellerLeadOrThrow(sellerLeadId, executor);
  }

  private async getSellerLeadOrThrow(sellerLeadId: string, executor = this.db) {
    const lead = await executor
      .selectFrom('crm.seller_leads')
      .select(['id', 'status'])
      .where('id', '=', sellerLeadId)
      .executeTakeFirst();
    if (!lead)
      throw new NotFoundException(`Seller lead ${sellerLeadId} was not found`);
    return lead;
  }

  private async getInspectionOrThrow(sellerLeadId: string, executor = this.db) {
    const inspection = await executor
      .selectFrom('crm.seller_lead_inspections')
      .selectAll()
      .where('seller_lead_id', '=', sellerLeadId)
      .executeTakeFirst();
    if (!inspection) {
      throw new NotFoundException('Start an inspection before saving changes');
    }
    return inspection;
  }

  private normalizeSections(sections: InspectionTemplateSectionDto[]) {
    if (sections.length === 0) {
      throw new BadRequestException(
        'At least one checklist section is required',
      );
    }
    const usedStableKeys = new Map<string, number>();
    return sections.map((section, sectionIndex) => ({
      ...section,
      label: this.requireText(section.label, 'section label'),
      sortOrder: section.sortOrder ?? sectionIndex,
      isActive: section.isActive ?? true,
      items: (section.items ?? []).map((item, itemIndex) => ({
        ...item,
        label: this.requireText(item.label, 'item label'),
        stableKey: this.getUniqueStableKey(
          item.stableKey ?? this.slugify(item.label ?? ''),
          usedStableKeys,
        ),
        sortOrder: item.sortOrder ?? itemIndex,
        isRequired: item.isRequired ?? true,
        isActive: item.isActive ?? true,
        findingKey: this.normalizeFindingKey(item.findingKey),
      })),
    }));
  }

  private normalizeAnswers(value: unknown): InspectionAnswers {
    if (!value || typeof value !== 'object') return {};
    const answers: InspectionAnswers = {};
    for (const [itemId, raw] of Object.entries(value as Record<string, any>)) {
      const rating = raw?.rating ?? null;
      if (rating !== null && !VALID_RATINGS.includes(rating)) {
        throw new BadRequestException(`Unsupported rating for ${itemId}`);
      }
      answers[itemId] = {
        rating,
        notes: this.optionalText(raw?.notes) ?? null,
      };
    }
    return answers;
  }

  private normalizeFindingKey(value: string | null | undefined) {
    if (!value) return null;
    if (VALID_FINDING_KEYS.includes(value as any)) return value;
    throw new BadRequestException(`Unsupported finding key: ${value}`);
  }

  private ensurePublishable(sections: InspectionTemplateSectionDto[]) {
    const activeSections = sections.filter(
      (section) => section.isActive !== false,
    );
    const activeItems = activeSections.flatMap((section) =>
      (section.items ?? []).filter((item) => item.isActive !== false),
    );
    if (activeSections.length === 0 || activeItems.length === 0) {
      throw new BadRequestException(
        'Publish requires at least one active item',
      );
    }
  }

  private getMissingRequiredItems(
    snapshot: TemplateSnapshot,
    answers: InspectionAnswers,
  ) {
    return snapshot.sections
      .filter((section) => section.isActive)
      .flatMap((section) => section.items)
      .filter((item) => item.isActive && item.isRequired)
      .filter((item) => !answers[item.id]?.rating)
      .map((item) => item.label);
  }

  private calculateOverallCondition(answers: InspectionAnswers) {
    const ratings = Object.values(answers)
      .map((answer) => answer.rating)
      .filter(Boolean);
    if (ratings.includes('poor')) return 'poor';
    if (ratings.includes('fair')) return 'fair';
    return 'good';
  }

  private aggregateFindings(
    snapshot: TemplateSnapshot,
    answers: InspectionAnswers,
  ) {
    const findings: Record<string, { rating: Rating; notes: string | null }> =
      {};
    const priority = { good: 1, fair: 2, poor: 3 };

    for (const section of snapshot.sections) {
      for (const item of section.items) {
        if (!item.findingKey) continue;
        const answer = answers[item.id];
        if (!answer?.rating) continue;
        const current = findings[item.findingKey];
        const notes = answer.notes ? `${item.label}: ${answer.notes}` : null;
        findings[item.findingKey] = {
          rating:
            !current || priority[answer.rating] > priority[current.rating]
              ? answer.rating
              : current.rating,
          notes: [current?.notes, notes].filter(Boolean).join('\n') || null,
        };
      }
    }

    return findings;
  }

  private buildLegacyInspectionNotes(inspection: any) {
    return [
      inspection.inspector_notes,
      inspection.major_issues
        ? `Major issues: ${inspection.major_issues}`
        : null,
      inspection.recommended_repairs
        ? `Recommended repairs: ${inspection.recommended_repairs}`
        : null,
      inspection.estimated_repair_cost
        ? `Estimated repair cost: ${inspection.estimated_repair_cost}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private mapTemplate(row: any) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isDefault: row.is_default,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapPublished(row: any) {
    return {
      id: row.id,
      templateId: row.templateId,
      name: row.name,
      description: row.description,
      versionNumber: row.versionNumber,
      publishedAt: row.publishedAt,
      isDefault: row.isDefault,
    };
  }

  private mapInspection(row: any) {
    return {
      id: row.id,
      sellerLeadId: row.seller_lead_id,
      templateVersionId: row.template_version_id,
      templateSnapshot: row.template_snapshot,
      answers: row.answers ?? {},
      majorIssues: row.major_issues,
      recommendedRepairs: row.recommended_repairs,
      inspectorNotes: row.inspector_notes,
      estimatedRepairCost: row.estimated_repair_cost,
      overallCondition: row.overall_condition,
      status: row.status,
      completedAt: row.completed_at,
      inspectorUserId: row.inspector_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizeMoney(value: string | number | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException(
        'estimatedRepairCost must be a valid amount',
      );
    }
    return amount.toFixed(2);
  }

  private optionalText(value: unknown) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text || null;
  }

  private requireText(value: unknown, field: string) {
    const text = String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private slugify(value: string) {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return slug || `item-${Date.now()}`;
  }

  private getUniqueStableKey(
    value: string,
    usedStableKeys: Map<string, number>,
  ) {
    const base = this.slugify(value);
    const count = usedStableKeys.get(base) ?? 0;
    usedStableKeys.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }
}
