import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
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
  listAll(@Query() query: ListActivityHistoryQueryDto) {
    return this.activityHistoryService.listAll(query);
  }

  @Get('summary')
  getSummary(@Query() query: ListActivityHistoryQueryDto) {
    return this.activityHistoryService.getSummary(query);
  }

  @Get('export')
  async exportLogs(
    @Query() query: ListActivityHistoryQueryDto,
    @Res() res: Response,
  ) {
    const exportResult = await this.activityHistoryService.exportLogs(query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportResult.filename}"`,
    );
    res.send(exportResult.csv);
  }

  @Get(':entityType/:entityId')
  listForEntity(
    @Param('entityType') entityType: ActivityEntityType,
    @Param('entityId') entityId: string,
    @Query() query: ListActivityHistoryQueryDto,
  ) {
    return this.activityHistoryService.listForEntity(
      entityType,
      entityId,
      query,
    );
  }
}
