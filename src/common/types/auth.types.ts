import type { Request } from 'express';

import type { RoleName, User } from '../../database/schema';
import type { PermissionScope } from '../auth/permissions';

export interface AuthTokenPayload {
  type: 'access';
  sub: string;
  role: RoleName;
  sessionId: string;
  jti: string;
}

export interface RefreshTokenPayload {
  type: 'refresh';
  sub: string;
  sessionId: string;
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: CurrentUser;
}

export interface CurrentUser {
  id: User['id'];
  email: User['email'];
  fullName: User['full_name'];
  role: RoleName;
  roleId: string;
  roleName: string;
  isAdministrator: boolean;
  permissions: Record<string, PermissionScope>;
  mustChangePassword: User['must_change_password'];
  active: User['active'];
}
