import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { ReportExportQueryDto, ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/**
 * Internal reporting endpoints. Guarded by AccessTokenGuard only — both `admin`
 * and `staff` may review business reports (operational staff + management).
 *
 * JSON endpoints feed the reporting UI; the `/:domain/export` endpoint streams a
 * CSV built from the exact same filtered computations so exports always match
 * what the user is viewing.
 */
@UseGuards(AccessTokenGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  getOverview(@Query() query: ReportQueryDto) {
    return this.reportsService.getOverview(query);
  }

  @Get('sales')
  getSales(@Query() query: ReportQueryDto) {
    return this.reportsService.getSalesReport(query);
  }

  @Get('inventory')
  getInventory(@Query() query: ReportQueryDto) {
    return this.reportsService.getInventoryReport(query);
  }

  @Get('leads')
  getLeads(@Query() query: ReportQueryDto) {
    return this.reportsService.getLeadsReport(query);
  }

  @Get('profitability')
  getProfitability(@Query() query: ReportQueryDto) {
    return this.reportsService.getProfitabilityReport(query);
  }

  @Get(':domain/export')
  async exportReport(
    @Param('domain') domain: string,
    @Query() query: ReportExportQueryDto,
    @Res() res: Response,
  ) {
    const { filename, csv } = await this.reportsService.exportReport(
      domain,
      query,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
