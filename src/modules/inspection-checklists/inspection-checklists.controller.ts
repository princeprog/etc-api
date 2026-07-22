import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as AuthUser } from '../../common/types/auth.types';
import {
  CreateInspectionTemplateDto,
  UpdateInspectionChecklistSettingsDto,
  UpdateInspectionTemplateDraftDto,
} from './dto/inspection-template.dto';
import { UpdateSellerLeadInspectionDto } from './dto/seller-lead-inspection.dto';
import { InspectionChecklistsService } from './inspection-checklists.service';

@UseGuards(AccessTokenGuard)
@Controller()
export class InspectionChecklistsController {
  constructor(private readonly service: InspectionChecklistsService) {}

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Get('inspection-checklist-settings')
  getChecklistSettings() {
    return this.service.getChecklistSettings();
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Put('inspection-checklist-settings')
  updateChecklistSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInspectionChecklistSettingsDto,
  ) {
    return this.service.updateChecklistSettings(user, dto);
  }

  @Get('inspection-templates/published')
  listPublishedTemplates() {
    return this.service.listPublishedTemplates();
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Get('inspection-templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Post('inspection-templates')
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInspectionTemplateDto,
  ) {
    return this.service.createTemplate(user, dto);
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Get('inspection-templates/:id')
  getTemplate(@Param('id') id: string) {
    return this.service.getTemplate(id);
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Patch('inspection-templates/:id/draft')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateInspectionTemplateDraftDto,
  ) {
    return this.service.updateDraft(user, id, dto);
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Post('inspection-templates/:id/publish')
  publishTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.publishTemplate(user, id);
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Post('inspection-templates/:id/set-default')
  setDefaultTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.setDefaultTemplate(user, id);
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Post('inspection-templates/:id/archive')
  archiveTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.archiveTemplate(user, id);
  }

  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.inspectionChecklistsManage)
  @Post('inspection-templates/:id/restore')
  restoreTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restoreTemplate(user, id);
  }

  @Get('seller-leads/:id/inspection')
  getSellerLeadInspection(@Param('id') id: string) {
    return this.service.getSellerLeadInspection(id);
  }

  @Post('seller-leads/:id/inspection')
  startSellerLeadInspection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.startSellerLeadInspection(user, id);
  }

  @Patch('seller-leads/:id/inspection')
  updateSellerLeadInspection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSellerLeadInspectionDto,
  ) {
    return this.service.updateSellerLeadInspection(user, id, dto);
  }

  @Post('seller-leads/:id/inspection/complete')
  completeSellerLeadInspection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.completeSellerLeadInspection(user, id);
  }
}
