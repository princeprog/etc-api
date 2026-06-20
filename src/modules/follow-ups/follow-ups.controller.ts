import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { CompleteFollowUpDto } from './dto/complete-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { FollowUpsService } from './follow-ups.service';

@UseGuards(AccessTokenGuard)
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Post()
  create(@Body() dto: CreateFollowUpDto) {
    return this.followUpsService.create(dto);
  }

  @Get()
  findAll(@Query('status') status?: string) {
    return this.followUpsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }

  @HttpCode(200)
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteFollowUpDto) {
    return this.followUpsService.complete(id, dto);
  }
}
