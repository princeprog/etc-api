import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from './common/decorators/current-user.decorator';
import { AccessTokenGuard } from './common/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from './common/types/auth.types';

@Controller()
export class AppController {
  @UseGuards(AccessTokenGuard)
  @Get()
  getDashboard(@CurrentUser() user: CurrentUserType) {
    return {
      message: 'Authenticated dashboard access',
      user,
    };
  }
}
