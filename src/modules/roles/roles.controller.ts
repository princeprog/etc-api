import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { CurrentUser as AuthUser } from '../../common/types/auth.types';
import { ArchiveRoleDto, SaveRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('admin')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  listRoles() {
    return this.rolesService.listRoles();
  }

  @Get('permissions')
  listPermissions() {
    return this.rolesService.listPermissions();
  }

  @Get(':id')
  getRole(@Param('id') id: string) {
    return this.rolesService.getRole(id);
  }

  @Post()
  createRole(@CurrentUser() user: AuthUser, @Body() dto: SaveRoleDto) {
    return this.rolesService.createRole(user, dto);
  }

  @Put(':id')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SaveRoleDto,
  ) {
    return this.rolesService.updateRole(user, id, dto);
  }

  @Post(':id/archive')
  archiveRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ArchiveRoleDto,
  ) {
    return this.rolesService.archiveRole(user, id, dto);
  }

  @Post(':id/restore')
  restoreRole(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rolesService.restoreRole(user, id);
  }
}
