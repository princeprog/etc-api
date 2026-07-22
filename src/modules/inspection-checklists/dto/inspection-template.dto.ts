export type InspectionTemplateItemDto = {
  id?: string;
  stableKey?: string;
  label?: string;
  findingKey?: string | null;
  isRequired?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};

export type InspectionTemplateSectionDto = {
  id?: string;
  label?: string;
  isActive?: boolean;
  sortOrder?: number;
  items?: InspectionTemplateItemDto[];
};

export class CreateInspectionTemplateDto {
  name?: string;
  description?: string | null;
  sourceVersionId?: string;
  sections?: InspectionTemplateSectionDto[];
}

export class UpdateInspectionTemplateDraftDto {
  name?: string;
  description?: string | null;
  sections?: InspectionTemplateSectionDto[];
}

export class UpdateInspectionChecklistSettingsDto {
  expectedRevision?: number;
  sections?: InspectionTemplateSectionDto[];
}
