import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { ActivityEntityType } from '../../database/schema';
import { ListActivityHistoryQueryDto } from './dto/list-activity-history-query.dto';
import { ActivityHistoryService } from './activity-history.service';

@UseGuards(AccessTokenGuard)
@Controller('activity-history')
export class ActivityHistoryController {
  constructor(private readonly activityHistoryService: ActivityHistoryService) {}

  @Get()
  listAll(@Query() query: ListActivityHistoryQueryDto) {
    return this.activityHistoryService.listAll(query);
  }

  @Get(':entityType/:entityId')
  listForEntity(
    @Param('entityType') entityType: ActivityEntityType,
    @Param('entityId') entityId: string,
    @Query() query: ListActivityHistoryQueryDto,
  ) {
    return this.activityHistoryService.listForEntity(entityType, entityId, query);
  }
}
