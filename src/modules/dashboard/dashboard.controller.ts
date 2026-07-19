import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@UseGuards(AccessTokenGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @CurrentUser() user: CurrentUserType,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDashboard(user, query);
  }
}
