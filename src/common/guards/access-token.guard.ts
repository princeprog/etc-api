import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ACCESS_TOKEN_COOKIE } from '../constants/auth.constants';
import type {
  AuthenticatedRequest,
  AuthTokenPayload,
  CurrentUser,
} from '../types/auth.types';
import { parseRole } from '../utils/auth.utils';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = request.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!accessToken) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: AuthTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AuthTokenPayload>(
        accessToken,
        {
          secret: process.env.JWT_ACCESS_SECRET,
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid access token');
    }

    const session = await this.db
      .selectFrom('authentication.sessions')
      .innerJoin(
        'authentication.users',
        'authentication.users.id',
        'authentication.sessions.user_id',
      )
      .select([
        'authentication.sessions.id as sessionId',
        'authentication.sessions.current_access_token_jti as currentAccessTokenJti',
        'authentication.sessions.expires_at as sessionExpiresAt',
        'authentication.sessions.revoked_at as sessionRevokedAt',
        'authentication.users.id as userId',
        'authentication.users.email as userEmail',
        'authentication.users.full_name as userFullName',
        'authentication.users.role as userRole',
        'authentication.users.must_change_password as userMustChangePassword',
        'authentication.users.active as userActive',
      ])
      .where('authentication.sessions.id', '=', payload.sessionId)
      .executeTakeFirst();

    if (!session || !session.userActive) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (session.sessionRevokedAt || session.sessionExpiresAt <= new Date()) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (
      session.currentAccessTokenJti !== payload.jti ||
      session.userId !== payload.sub
    ) {
      throw new UnauthorizedException('Access token has been revoked');
    }

    request.authUser = {
      id: session.userId,
      email: session.userEmail,
      fullName: session.userFullName,
      role: parseRole(session.userRole),
      mustChangePassword: session.userMustChangePassword,
      active: session.userActive,
    } satisfies CurrentUser;

    return true;
  }
}
