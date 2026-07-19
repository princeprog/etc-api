import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(AccessTokenGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.list(user, query);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: CurrentUserType) {
    return this.notificationsService.getUnreadCount(user);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.notificationsService.markRead(user, id);
  }

  @Patch(':id/unread')
  markUnread(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.notificationsService.markUnread(user, id);
  }

  @Post('mark-all-read')
  markAllRead(@CurrentUser() user: CurrentUserType) {
    return this.notificationsService.markAllRead(user);
  }
}
