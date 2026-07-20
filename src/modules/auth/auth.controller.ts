import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
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
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

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

  @UseGuards(AccessTokenGuard)
  @Get('realtime-token')
  async realtimeToken(@CurrentUser() user: CurrentUserType) {
    return this.authService.createRealtimeToken(user);
  }

  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.refresh(
      request.cookies?.[REFRESH_TOKEN_COOKIE],
      response,
    );
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(
      request.cookies?.[REFRESH_TOKEN_COOKIE],
      response,
    );
  }

  @UseGuards(AccessTokenGuard)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: CurrentUserType,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user, changePasswordDto);
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

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.authService.listUsers(query);
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Post('users')
  createUser(
    @CurrentUser() user: CurrentUserType,
    @Body() createUserDto: CreateUserDto,
  ) {
    return this.authService.createUser(createUserDto, user);
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body() updateUserStatusDto: UpdateUserStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.authService.updateUserStatus(id, updateUserStatusDto, user);
  }
}
