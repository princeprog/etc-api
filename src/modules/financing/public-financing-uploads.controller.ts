import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  SubmitFinancingUploadDto,
  VerifyFinancingUploadDto,
} from './dto/financing.dto';
import { FINANCING_MAX_DOCUMENT_SIZE_BYTES } from './financing.helpers';
import { FinancingService } from './financing.service';

type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Controller('public/financing-uploads/:token')
export class PublicFinancingUploadsController {
  constructor(private readonly financingService: FinancingService) {}

  @Post('verify')
  verify(
    @Param('token') token: string,
    @Body() dto: VerifyFinancingUploadDto,
    @Ip() ipAddress: string,
  ) {
    return this.financingService.verifyPublicUpload(
      token,
      dto.contactNumber,
      ipAddress,
    );
  }

  @Get()
  getChecklist(
    @Param('token') token: string,
    @Headers('x-financing-upload-session') sessionToken?: string,
  ) {
    return this.financingService.getPublicChecklist(token, sessionToken);
  }

  @Post('requirements/:requirementId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: FINANCING_MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  uploadDocument(
    @Param('token') token: string,
    @Param('requirementId') requirementId: string,
    @Headers('x-financing-upload-session') sessionToken: string | undefined,
    @UploadedFile() file: UploadedFile,
  ) {
    return this.financingService.uploadPublicRequirementDocument(
      token,
      sessionToken,
      requirementId,
      file,
    );
  }

  @Delete('requirements/:requirementId/documents/current')
  removeCurrentDocument(
    @Param('token') token: string,
    @Param('requirementId') requirementId: string,
    @Headers('x-financing-upload-session') sessionToken?: string,
  ) {
    return this.financingService.removePublicCurrentDocument(
      token,
      sessionToken,
      requirementId,
    );
  }

  @Post('submit')
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitFinancingUploadDto,
  ) {
    return this.financingService.submitPublicRequirements(
      token,
      dto.sessionToken,
    );
  }

  @Get('documents/:documentId/download')
  getDocumentDownloadUrl(
    @Param('token') token: string,
    @Param('documentId') documentId: string,
    @Headers('x-financing-upload-session') sessionToken?: string,
  ) {
    return this.financingService.getPublicDocumentDownloadUrl(
      token,
      sessionToken,
      documentId,
    );
  }
}
