import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RoleName } from '../../../database/schema';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const currentUser = request.authUser;

    if (!currentUser) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!roles.includes(currentUser.role)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }

    return true;
  }
}
