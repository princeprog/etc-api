import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from './modules/auth/decorators/current-user.decorator';
import { AccessTokenGuard } from './modules/auth/guards/access-token.guard';
import type { CurrentUser as CurrentUserType } from './modules/auth/auth.types';

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
