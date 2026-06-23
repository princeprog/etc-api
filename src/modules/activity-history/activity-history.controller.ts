import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { ActivityEntityType } from '../../database/schema';
import { ActivityHistoryService } from './activity-history.service';

@UseGuards(AccessTokenGuard)
@Controller('activity-history')
export class ActivityHistoryController {
  constructor(private readonly activityHistoryService: ActivityHistoryService) {}

  @Get()
  listAll(@Query('limit') limit?: string) {
    return this.activityHistoryService.listAll(limit ? Number(limit) : undefined);
  }

  @Get(':entityType/:entityId')
  listForEntity(
    @Param('entityType') entityType: ActivityEntityType,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: string,
  ) {
    return this.activityHistoryService.listForEntity(
      entityType,
      entityId,
      limit ? Number(limit) : undefined,
    );
  }
}
