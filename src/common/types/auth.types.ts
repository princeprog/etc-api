import type { Request } from 'express';

import type { RoleName, User } from '../../database/schema';

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
}
