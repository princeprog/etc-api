import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ExpenseReportQueryDto } from './dto/expense-report-query.dto';
import { ExpenseReportsService } from './expense-reports.service';

@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('admin')
@Controller('expense-reports')
export class ExpenseReportsController {
  constructor(private readonly expenseReportsService: ExpenseReportsService) {}

  @Get('monthly')
  getMonthly(@Query() query: ExpenseReportQueryDto) {
    return this.expenseReportsService.getMonthlyReport(query);
  }

  @Get('export')
  async exportReport(
    @Query() query: ExpenseReportQueryDto,
    @Res() res: Response,
  ) {
    const { filename, csv } =
      await this.expenseReportsService.exportReport(query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
