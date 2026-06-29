import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import type { ActivityEntityType } from '../../database/schema';
import { ListActivityHistoryQueryDto } from './dto/list-activity-history-query.dto';
import { ActivityHistoryService } from './activity-history.service';

@UseGuards(AccessTokenGuard)
@Controller('activity-history')
export class ActivityHistoryController {
  constructor(private readonly activityHistoryService: ActivityHistoryService) {}

  @Get()
  listAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListActivityHistoryQueryDto,
  ) {
    return this.activityHistoryService.listAll(user, query);
  }

  @Get(':entityType/:entityId')
  listForEntity(
    @CurrentUser() user: CurrentUserType,
    @Param('entityType') entityType: ActivityEntityType,
    @Param('entityId') entityId: string,
    @Query() query: ListActivityHistoryQueryDto,
  ) {
    return this.activityHistoryService.listForEntity(
      entityType,
      entityId,
      user,
      query,
    );
  }
}
