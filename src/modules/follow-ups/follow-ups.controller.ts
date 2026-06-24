import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { CompleteFollowUpDto } from './dto/complete-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListFollowUpsQueryDto } from './dto/list-follow-ups-query.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
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
  findAll(@Query() query: ListFollowUpsQueryDto) {
    return this.followUpsService.findAll(query);
  }

  // Declared before `:id` so the literal route is not captured by the param route.
  @Get('summary')
  summary(@Query('assigneeUserId') assigneeUserId?: string) {
    return this.followUpsService.summary(assigneeUserId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFollowUpDto) {
    return this.followUpsService.update(id, dto);
  }

  @HttpCode(200)
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteFollowUpDto) {
    return this.followUpsService.complete(id, dto);
  }
}
