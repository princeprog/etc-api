import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { User } from '../../database/schema';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../../common/constants/auth.constants';
import type { LoginDto } from './dto/login.dto';
import type {
  AuthTokenPayload,
  CurrentUser,
  RefreshTokenPayload,
} from '../../common/types/auth.types';
import {
  durationToMs,
  generateTokenId,
  hashPassword,
  hashToken,
  parseRole,
  verifyPassword,
} from '../../common/utils/auth.utils';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
  ) {}

  async login(
    loginDto: LoginDto,
    response: Response,
  ): Promise<{ user: CurrentUser }> {
    const email = loginDto.email?.trim().toLowerCase();
    const password = loginDto.password;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.db
      .selectFrom('auth.users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();

    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await verifyPassword(password, user.password_hash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const normalizedUser = this.normalizeUser(user);

    await this.issueSessionTokens(normalizedUser, response);
    return { user: this.toCurrentUser(normalizedUser) };
  }

  async me(user: CurrentUser): Promise<{ user: CurrentUser }> {
    return { user };
  }

  async refresh(
    refreshToken: string | undefined,
    response: Response,
  ): Promise<{ user: CurrentUser }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: process.env.JWT_REFRESH_SECRET,
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.db
      .selectFrom('auth.sessions')
      .innerJoin('auth.users', 'auth.users.id', 'auth.sessions.user_id')
      .select([
        'auth.sessions.id as sessionId',
        'auth.sessions.user_id as userId',
        'auth.sessions.refresh_token_hash as refreshTokenHash',
        'auth.sessions.expires_at as expiresAt',
        'auth.sessions.revoked_at as revokedAt',
        'auth.users.id as userRecordId',
        'auth.users.email as userEmail',
        'auth.users.full_name as userFullName',
        'auth.users.role as userRole',
        'auth.users.password_hash as userPasswordHash',
        'auth.users.active as userActive',
        'auth.users.created_at as userCreatedAt',
        'auth.users.updated_at as userUpdatedAt',
      ])
      .where('auth.sessions.id', '=', payload.sessionId)
      .executeTakeFirst();

    if (!session || !session.userActive || session.userId !== payload.sub) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      await this.revokeSession(payload.sessionId);
      throw new UnauthorizedException('Session is no longer valid');
    }

    const incomingRefreshHash = hashToken(refreshToken);

    if (incomingRefreshHash !== session.refreshTokenHash) {
      await this.revokeSession(payload.sessionId);
      throw new UnauthorizedException('Refresh token has already been used');
    }

    const user: User = {
      id: session.userRecordId,
      email: session.userEmail,
      full_name: session.userFullName,
      role: parseRole(session.userRole),
      password_hash: session.userPasswordHash,
      active: session.userActive,
      created_at: session.userCreatedAt,
      updated_at: session.userUpdatedAt,
    };

    await this.rotateSessionTokens(user, payload.sessionId, response);
    return { user: this.toCurrentUser(user) };
  }

  async logout(
    refreshToken: string | undefined,
    response: Response,
  ): Promise<{ success: true }> {
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
          refreshToken,
          {
            secret: process.env.JWT_REFRESH_SECRET,
            ignoreExpiration: true,
          },
        );

        if (payload.type === 'refresh') {
          await this.revokeSession(payload.sessionId);
        }
      } catch {
        // best-effort revoke; cookies are still cleared below
      }
    }

    this.clearAuthCookies(response);
    return { success: true };
  }

  async createUser(
    createUserDto: CreateUserDto,
  ): Promise<{ user: CurrentUser }> {
    const email = createUserDto.email?.trim().toLowerCase();
    const password = createUserDto.password;
    const fullName = createUserDto.fullName?.trim();

    if (!email) {
      throw new BadRequestException('email is required');
    }

    if (!password) {
      throw new BadRequestException('password is required');
    }

    if (!fullName) {
      throw new BadRequestException('fullName is required');
    }

    const role = parseRole(createUserDto.role);

    const existingUser = await this.db
      .selectFrom('auth.users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (existingUser) {
      throw new BadRequestException(`User with email ${email} already exists`);
    }

    const insertedUser = await this.db
      .insertInto('auth.users')
      .values({
        email,
        password_hash: await hashPassword(password),
        full_name: fullName,
        role,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { user: this.toCurrentUser(this.normalizeUser(insertedUser)) };
  }

  private async issueSessionTokens(
    user: User,
    response: Response,
  ): Promise<void> {
    const accessTokenJti = generateTokenId();
    const refreshExpiresAt = new Date(Date.now() + this.refreshExpiresInMs);
    const refreshToken = await this.signRefreshToken(
      user.id,
      'pending-session',
    );
    const refreshTokenHash = hashToken(refreshToken);

    const session = await this.db
      .insertInto('auth.sessions')
      .values({
        user_id: user.id,
        current_access_token_jti: accessTokenJti,
        refresh_token_hash: refreshTokenHash,
        expires_at: refreshExpiresAt,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const finalRefreshToken = await this.signRefreshToken(user.id, session.id);
    const finalRefreshTokenHash = hashToken(finalRefreshToken);
    const accessToken = await this.signAccessToken(
      user,
      session.id,
      accessTokenJti,
    );

    await this.db
      .updateTable('auth.sessions')
      .set({
        refresh_token_hash: finalRefreshTokenHash,
        updated_at: new Date(),
      })
      .where('id', '=', session.id)
      .execute();

    this.setAuthCookies(response, accessToken, finalRefreshToken);
  }

  private async rotateSessionTokens(
    user: User,
    sessionId: string,
    response: Response,
  ): Promise<void> {
    const nextAccessTokenJti = generateTokenId();
    const nextRefreshToken = await this.signRefreshToken(user.id, sessionId);
    const nextAccessToken = await this.signAccessToken(
      user,
      sessionId,
      nextAccessTokenJti,
    );

    await this.db
      .updateTable('auth.sessions')
      .set({
        refresh_token_hash: hashToken(nextRefreshToken),
        current_access_token_jti: nextAccessTokenJti,
        expires_at: new Date(Date.now() + this.refreshExpiresInMs),
        last_rotated_at: new Date(),
        revoked_at: null,
        updated_at: new Date(),
      })
      .where('id', '=', sessionId)
      .execute();

    this.setAuthCookies(response, nextAccessToken, nextRefreshToken);
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .updateTable('auth.sessions')
      .set({
        revoked_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', sessionId)
      .execute();
  }

  private async signAccessToken(
    user: User,
    sessionId: string,
    tokenId: string,
  ): Promise<string> {
    const payload: AuthTokenPayload = {
      type: 'access',
      sub: user.id,
      role: user.role,
      sessionId,
      jti: tokenId,
    };

    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: Math.floor(this.accessExpiresInMs / 1000),
    });
  }

  private async signRefreshToken(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    const payload: RefreshTokenPayload = {
      type: 'refresh',
      sub: userId,
      sessionId,
      jti: generateTokenId(),
    };

    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: Math.floor(this.refreshExpiresInMs / 1000),
    });
  }

  private setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    response.cookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      this.cookieOptions(this.accessExpiresInMs),
    );
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken,
      this.cookieOptions(this.refreshExpiresInMs),
    );
  }

  clearAuthCookies(response: Response): void {
    response.clearCookie(ACCESS_TOKEN_COOKIE, this.cookieOptions());
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.cookieOptions());
  }

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      ...(maxAge ? { maxAge } : {}),
    };
  }

  private toCurrentUser(user: User): CurrentUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    };
  }

  private normalizeUser(user: {
    id: string;
    email: string;
    password_hash: string;
    full_name: string;
    role: string;
    active: boolean;
    created_at: Date;
    updated_at: Date;
  }): User {
    return {
      ...user,
      role: parseRole(user.role),
    };
  }

  private get accessExpiresInMs(): number {
    return durationToMs(process.env.JWT_ACCESS_EXPIRES_IN ?? '15m');
  }

  private get refreshExpiresInMs(): number {
    return durationToMs(process.env.JWT_REFRESH_EXPIRES_IN ?? '30d');
  }
}
