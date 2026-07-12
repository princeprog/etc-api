import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import type { ActivityEntityType } from '../../database/schema';
import { ListActivityHistoryQueryDto } from './dto/list-activity-history-query.dto';
import { ActivityHistoryService } from './activity-history.service';

@UseGuards(AccessTokenGuard)
@Controller('activity-history')
export class ActivityHistoryController {
  constructor(
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  @Get()
  listAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListActivityHistoryQueryDto,
  ) {
    return this.activityHistoryService.listAll(user, query);
  }

  @Get('summary')
  getSummary(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListActivityHistoryQueryDto,
  ) {
    return this.activityHistoryService.getSummary(user, query);
  }

  @Get('export')
  async exportLogs(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListActivityHistoryQueryDto,
    @Res() res: Response,
  ) {
    const exportResult = await this.activityHistoryService.exportLogs(
      user,
      query,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportResult.filename}"`,
    );
    res.send(exportResult.csv);
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
