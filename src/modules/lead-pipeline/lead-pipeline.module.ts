import { Module } from '@nestjs/common';

import { LeadPipelineService } from './lead-pipeline.service';

@Module({
  providers: [LeadPipelineService],
  exports: [LeadPipelineService],
})
export class LeadPipelineModule {}
