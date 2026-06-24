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
      .selectFrom('auth.sessions')
      .innerJoin('auth.users', 'auth.users.id', 'auth.sessions.user_id')
      .select([
        'auth.sessions.id as sessionId',
        'auth.sessions.current_access_token_jti as currentAccessTokenJti',
        'auth.sessions.expires_at as sessionExpiresAt',
        'auth.sessions.revoked_at as sessionRevokedAt',
        'auth.users.id as userId',
        'auth.users.email as userEmail',
        'auth.users.full_name as userFullName',
        'auth.users.role as userRole',
        'auth.users.active as userActive',
      ])
      .where('auth.sessions.id', '=', payload.sessionId)
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
    } satisfies CurrentUser;

    return true;
  }
}
