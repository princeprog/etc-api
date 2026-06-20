import { Controller, Get, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(AccessTokenGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard() {
    return this.dashboardService.getDashboard();
  }
}
