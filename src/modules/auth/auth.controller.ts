import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { REFRESH_TOKEN_COOKIE } from '../../common/constants/auth.constants';
import { LoginDto } from './dto/login.dto';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { CurrentUser as CurrentUserType } from '../../common/types/auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(loginDto, response);
  }

  @UseGuards(AccessTokenGuard)
  @Get('me')
  async me(@CurrentUser() user: CurrentUserType) {
    return this.authService.me(user);
  }

  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.refresh(request.cookies?.[REFRESH_TOKEN_COOKIE], response);
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(request.cookies?.[REFRESH_TOKEN_COOKIE], response);
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Get('admin-check')
  adminCheck(@CurrentUser() user: CurrentUserType) {
    return {
      user,
      access: 'granted',
    };
  }
}
