import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import {
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
import { FINANCING_MAX_DOCUMENT_SIZE_BYTES } from './financing.helpers';
import { FinancingService } from './financing.service';

type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller('financing')
export class FinancingController {
  constructor(private readonly financingService: FinancingService) {}

  @Get('partners')
  @RequirePermissions(PERMISSIONS.financingManagePartners)
  listPartners() {
    return this.financingService.listPartners();
  }

  @Post('partners')
  @RequirePermissions(PERMISSIONS.financingManagePartners)
  createPartner(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateFinancingPartnerDto,
  ) {
    return this.financingService.createPartner(user, dto);
  }

  @Patch('partners/:id')
  @RequirePermissions(PERMISSIONS.financingManagePartners)
  updatePartner(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateFinancingPartnerDto,
  ) {
    return this.financingService.updatePartner(user, id, dto);
  }

  @Post('partners/:id/representatives')
  @RequirePermissions(PERMISSIONS.financingManagePartners)
  upsertRepresentative(
    @Param('id') id: string,
    @Body() dto: UpsertPartnerRepresentativeDto,
  ) {
    return this.financingService.upsertRepresentative(id, dto);
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  listTemplates(@Query('partnerId') partnerId?: string) {
    return this.financingService.listTemplates(partnerId);
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  createTemplate(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateRequirementTemplateDto,
  ) {
    return this.financingService.createTemplate(user, dto);
  }

  @Patch('templates/:id')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  updateTemplate(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementTemplateDto,
  ) {
    return this.financingService.updateTemplate(user, id, dto);
  }

  @Get('applications')
  @RequirePermissions(PERMISSIONS.financingView)
  listApplications(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListFinancingApplicationsQueryDto,
  ) {
    return this.financingService.listApplications(user, query);
  }

  @Post('applications')
  @RequirePermissions(PERMISSIONS.financingCreate)
  createApplication(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateFinancingApplicationDto,
  ) {
    return this.financingService.createApplication(user, dto);
  }

  @Get('applications/:id')
  @RequirePermissions(PERMISSIONS.financingView)
  getApplication(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.financingService.getApplication(user, id);
  }

  @Patch('applications/:id')
  @RequirePermissions(PERMISSIONS.financingUpdate)
  updateApplication(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateFinancingApplicationDto,
  ) {
    return this.financingService.updateApplication(user, id, dto);
  }

  @Post('applications/:id/upload-link')
  @RequirePermissions(PERMISSIONS.financingUpdate)
  generateUploadLink(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.financingService.generateUploadLink(user, id);
  }

  @Post('applications/:id/upload-link/revoke')
  @RequirePermissions(PERMISSIONS.financingUpdate)
  revokeUploadLink(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.financingService.revokeUploadLink(user, id);
  }

  @Post('applications/:id/requirements/:requirementId/documents')
  @RequirePermissions(PERMISSIONS.financingUpdate)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: FINANCING_MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  uploadRequirementDocument(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('requirementId') requirementId: string,
    @UploadedFile() file: UploadedFile,
  ) {
    return this.financingService.uploadRequirementDocument(
      user,
      id,
      requirementId,
      file,
    );
  }

  @Post('applications/:id/requirements/:requirementId/review')
  @RequirePermissions(PERMISSIONS.financingReview)
  reviewRequirement(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('requirementId') requirementId: string,
    @Body() dto: ReviewFinancingRequirementDto,
  ) {
    return this.financingService.reviewRequirement(
      user,
      id,
      requirementId,
      dto,
    );
  }

  @Post('applications/:id/decision')
  @RequirePermissions(PERMISSIONS.financingDecide)
  decideApplication(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: DecideFinancingApplicationDto,
  ) {
    return this.financingService.decideApplication(user, id, dto);
  }

  @Post('applications/:id/loan-release')
  @RequirePermissions(PERMISSIONS.financingRecordLoanRelease)
  recordLoanRelease(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: RecordLoanReleaseDto,
  ) {
    return this.financingService.recordLoanRelease(user, id, dto);
  }

  @Post('applications/:id/vehicle-release')
  @RequirePermissions(PERMISSIONS.financingRecordVehicleRelease)
  recordVehicleRelease(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: RecordVehicleReleaseDto,
  ) {
    return this.financingService.recordVehicleRelease(user, id, dto);
  }

  @Post('applications/:id/cancel')
  @RequirePermissions(PERMISSIONS.financingUpdate)
  cancelApplication(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: CancelFinancingApplicationDto,
  ) {
    return this.financingService.cancelApplication(user, id, dto);
  }

  @Get('applications/:id/documents/:documentId/download')
  @RequirePermissions(PERMISSIONS.financingView)
  getDocumentDownloadUrl(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.financingService.getDocumentDownloadUrl(user, id, documentId);
  }
}
