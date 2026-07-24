import { Module } from '@nestjs/common';

import { LeadAssignmentService } from './lead-assignment.service';

@Module({
  providers: [LeadAssignmentService],
  exports: [LeadAssignmentService],
})
export class LeadAssignmentModule {}
