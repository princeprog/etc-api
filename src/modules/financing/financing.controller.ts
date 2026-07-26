import {
  Body,
  Controller,
  Delete,
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
  CreateFinancingRequirementDto,
  DecideFinancingApplicationDto,
  ListFinancingApplicationsQueryDto,
  RecordLoanReleaseDto,
  RecordVehicleReleaseDto,
  ReviewFinancingRequirementDto,
  UpdateFinancingApplicationDto,
  UpdateFinancingRequirementDto,
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

  @Get('requirements')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  listRequirements() {
    return this.financingService.listRequirements();
  }

  @Post('requirements')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  createRequirement(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateFinancingRequirementDto,
  ) {
    return this.financingService.createRequirement(user, dto);
  }

  @Patch('requirements/:id')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  updateRequirement(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateFinancingRequirementDto,
  ) {
    return this.financingService.updateRequirement(user, id, dto);
  }

  @Delete('requirements/:id')
  @RequirePermissions(PERMISSIONS.financingManageTemplates)
  deleteRequirement(@Param('id') id: string) {
    return this.financingService.deleteRequirement(id);
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
