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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
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
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateFollowUpDto) {
    return this.followUpsService.create(user, dto);
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

  @Get('active')
  findActive(
    @Query('leadType') leadType?: string,
    @Query('leadId') leadId?: string,
  ) {
    return this.followUpsService.findActive(leadType, leadId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpDto,
  ) {
    return this.followUpsService.update(user, id, dto);
  }

  @HttpCode(200)
  @Post(':id/complete')
  complete(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: CompleteFollowUpDto,
  ) {
    return this.followUpsService.complete(user, id, dto);
  }
}
