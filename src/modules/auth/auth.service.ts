import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPrivateKey, type JsonWebKey } from 'crypto';
import type { Response } from 'express';
import { sign } from 'jsonwebtoken';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { RoleName, User } from '../../database/schema';
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
  buildPaginatedResponse,
  parsePagination,
  type PaginationParams,
} from '../../common/utils/list-query.utils';
import {
  durationToMs,
  generateTokenId,
  hashPassword,
  hashToken,
  parseRole,
  verifyPassword,
} from '../../common/utils/auth.utils';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ActivityHistoryService } from '../activity-history/activity-history.service';

const DEFAULT_STAFF_PASSWORD = '123456';
const MIN_PASSWORD_LENGTH = 6;
const DEFAULT_REALTIME_TOKEN_TTL_SECONDS = 10 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
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
      .selectFrom('authentication.users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      throw new UnauthorizedException(
        'This account has been disabled by an admin. Please contact your administrator.',
      );
    }

    const passwordMatches = await verifyPassword(password, user.password_hash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const normalizedUser = this.normalizeUser(user);

    await this.issueSessionTokens(normalizedUser, response);
    return { user: this.toCurrentUser(normalizedUser) };
  }

  me(user: CurrentUser): { user: CurrentUser } {
    return { user };
  }

  createRealtimeToken(user: CurrentUser): {
    token: string;
    expiresAt: string;
  } {
    const privateJwk = this.getRealtimePrivateJwk();
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const ttlInSeconds = this.realtimeTokenTtlSeconds;
    const expiresAt = new Date((nowInSeconds + ttlInSeconds) * 1000);
    const privateKey = createPrivateKey({
      key: privateJwk,
      format: 'jwk',
    });

    const token = sign(
      {
        sub: user.id,
        role: 'authenticated',
        iat: nowInSeconds,
        exp: nowInSeconds + ttlInSeconds,
      },
      privateKey,
      {
        algorithm: 'ES256',
        keyid: privateJwk.kid,
        header: {
          alg: 'ES256',
          kid: privateJwk.kid,
          typ: 'JWT',
        },
      },
    );

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
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
      .selectFrom('authentication.sessions')
      .innerJoin(
        'authentication.users',
        'authentication.users.id',
        'authentication.sessions.user_id',
      )
      .select([
        'authentication.sessions.id as sessionId',
        'authentication.sessions.user_id as userId',
        'authentication.sessions.refresh_token_hash as refreshTokenHash',
        'authentication.sessions.expires_at as expiresAt',
        'authentication.sessions.revoked_at as revokedAt',
        'authentication.users.id as userRecordId',
        'authentication.users.email as userEmail',
        'authentication.users.full_name as userFullName',
        'authentication.users.role as userRole',
        'authentication.users.password_hash as userPasswordHash',
        'authentication.users.active as userActive',
        'authentication.users.must_change_password as userMustChangePassword',
        'authentication.users.created_at as userCreatedAt',
        'authentication.users.updated_at as userUpdatedAt',
      ])
      .where('authentication.sessions.id', '=', payload.sessionId)
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
      throw new UnauthorizedException('Refresh token has already been used');
    }

    const user: User = {
      id: session.userRecordId,
      email: session.userEmail,
      full_name: session.userFullName,
      role: parseRole(session.userRole),
      password_hash: session.userPasswordHash,
      must_change_password: session.userMustChangePassword,
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
    currentUser: CurrentUser,
  ): Promise<{ user: CurrentUser }> {
    const email = createUserDto.email?.trim().toLowerCase();
    const role = this.parseCreateUserRole(createUserDto.role);
    const password = this.resolveCreateUserPassword(
      createUserDto.password,
      role,
    );
    const fullName =
      createUserDto.fullName?.trim() || this.deriveFullNameFromEmail(email);

    if (!email) {
      throw new BadRequestException('email is required');
    }

    if (!fullName) {
      throw new BadRequestException('fullName is required');
    }

    const existingUser = await this.db
      .selectFrom('authentication.users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (existingUser) {
      throw new BadRequestException(`User with email ${email} already exists`);
    }

    const insertedUser = await this.db
      .insertInto('authentication.users')
      .values({
        email,
        password_hash: await hashPassword(password),
        full_name: fullName,
        role,
        must_change_password: role === 'staff',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: insertedUser.id,
      actionType: 'user.created',
      summary: 'Staff account created',
      metadata: {
        email: insertedUser.email,
        fullName: insertedUser.full_name,
        role: insertedUser.role,
        mustChangePassword: insertedUser.must_change_password,
      },
    });

    return { user: this.toCurrentUser(this.normalizeUser(insertedUser)) };
  }

  async listUsers(query: ListUsersQueryDto): Promise<{
    users: CurrentUser[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    summary: {
      adminCount: number;
      totalStaffCount: number;
      activeStaffCount: number;
      disabledStaffCount: number;
    };
  }> {
    const pagination = parsePagination(query);
    const total = await this.countFilteredStaffUsers(query);
    const summary = await this.getUsersSummary();
    const users = await this.getFilteredStaffUsers(query, pagination);
    const response = buildPaginatedResponse(
      users.map((user) => this.toCurrentUser(this.normalizeUser(user))),
      pagination,
      total,
    );

    return {
      users: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
      summary,
    };
  }

  private buildFilteredStaffUsersQuery(query: ListUsersQueryDto) {
    const search = query.search?.trim();
    const status = query.status?.trim();
    let usersQuery = this.db
      .selectFrom('authentication.users')
      .where('role', '=', 'staff');

    if (search) {
      usersQuery = usersQuery.where((expressionBuilder) =>
        expressionBuilder.or([
          expressionBuilder('email', 'ilike', `%${search}%`),
          expressionBuilder('full_name', 'ilike', `%${search}%`),
        ]),
      );
    }

    if (status) {
      switch (status) {
        case 'active':
          usersQuery = usersQuery
            .where('active', '=', true)
            .where('must_change_password', '=', false);
          break;
        case 'disabled':
          usersQuery = usersQuery.where('active', '=', false);
          break;
        case 'change_password_required':
          usersQuery = usersQuery
            .where('active', '=', true)
            .where('must_change_password', '=', true);
          break;
        default:
          throw new BadRequestException(
            'status must be active, disabled, or change_password_required',
          );
      }
    }

    return usersQuery;
  }

  private async countFilteredStaffUsers(query: ListUsersQueryDto) {
    const totalRow = await this.buildFilteredStaffUsersQuery(query)
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(totalRow.count);
  }

  private async getFilteredStaffUsers(
    query: ListUsersQueryDto,
    pagination: PaginationParams,
  ) {
    return this.buildFilteredStaffUsersQuery(query)
      .selectAll()
      .orderBy('created_at', 'asc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();
  }

  private async getUsersSummary() {
    const rows = await this.db
      .selectFrom('authentication.users')
      .select(['role', 'active'])
      .execute();

    const staffUsers = rows.filter((user) => user.role === 'staff');

    return {
      adminCount: rows.filter((user) => user.role === 'admin').length,
      totalStaffCount: staffUsers.length,
      activeStaffCount: staffUsers.filter((user) => user.active).length,
      disabledStaffCount: staffUsers.filter((user) => !user.active).length,
    };
  }

  async updateUserStatus(
    userId: string,
    updateUserStatusDto: { active: boolean },
    currentUser: CurrentUser,
  ): Promise<{ user: CurrentUser }> {
    if (typeof updateUserStatusDto.active !== 'boolean') {
      throw new BadRequestException('active must be a boolean');
    }

    if (userId === currentUser.id && updateUserStatusDto.active === false) {
      throw new BadRequestException('You cannot disable your own account');
    }

    const existingUser = await this.db
      .selectFrom('authentication.users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!existingUser) {
      throw new BadRequestException('User not found');
    }

    if (existingUser.role !== 'staff') {
      throw new BadRequestException('Only staff accounts can be updated here');
    }

    const updatedUser = await this.db
      .updateTable('authentication.users')
      .set({
        active: updateUserStatusDto.active,
        updated_at: new Date(),
      })
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();

    if (!updateUserStatusDto.active) {
      await this.db
        .deleteFrom('authentication.sessions')
        .where('user_id', '=', userId)
        .execute();
    }

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: updatedUser.id,
      actionType: 'user.status_changed',
      summary: updateUserStatusDto.active
        ? 'Staff account enabled'
        : 'Staff account disabled',
      metadata: {
        email: updatedUser.email,
        fullName: updatedUser.full_name,
        from: existingUser.active,
        to: updatedUser.active,
      },
    });
    return { user: this.toCurrentUser(this.normalizeUser(updatedUser)) };
  }

  async changePassword(
    currentUser: CurrentUser,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ user: CurrentUser }> {
    const newPassword = changePasswordDto.newPassword;

    if (!newPassword) {
      throw new BadRequestException('New password is required');
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }

    const user = await this.db
      .selectFrom('authentication.users')
      .selectAll()
      .where('id', '=', currentUser.id)
      .executeTakeFirst();

    if (!user || !user.active) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (await verifyPassword(newPassword, user.password_hash)) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const updatedUser = await this.db
      .updateTable('authentication.users')
      .set({
        password_hash: await hashPassword(newPassword),
        must_change_password: false,
        updated_at: new Date(),
      })
      .where('id', '=', currentUser.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: updatedUser.id,
      actionType: 'user.password_changed',
      summary: 'Password changed',
      metadata: {
        mustChangePasswordCleared:
          user.must_change_password && !updatedUser.must_change_password,
      },
    });
    return { user: this.toCurrentUser(this.normalizeUser(updatedUser)) };
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
      .insertInto('authentication.sessions')
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
      .updateTable('authentication.sessions')
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
      .updateTable('authentication.sessions')
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
      .updateTable('authentication.sessions')
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
    const isProduction = process.env.NODE_ENV === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
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
      mustChangePassword: user.must_change_password,
      active: user.active,
    };
  }

  private normalizeUser(user: {
    id: string;
    email: string;
    password_hash: string;
    full_name: string;
    role: string;
    must_change_password: boolean;
    active: boolean;
    created_at: Date;
    updated_at: Date;
  }): User {
    return {
      ...user,
      role: parseRole(user.role),
    };
  }

  private parseCreateUserRole(role: RoleName | undefined): RoleName {
    if (!role) {
      return 'staff';
    }

    try {
      return parseRole(role);
    } catch {
      throw new BadRequestException('role must be either admin or staff');
    }
  }

  private resolveCreateUserPassword(
    password: string | undefined,
    role: RoleName,
  ): string {
    if (password) {
      return password;
    }

    if (role === 'staff') {
      return DEFAULT_STAFF_PASSWORD;
    }

    throw new BadRequestException(
      'password is required when creating an admin user',
    );
  }

  private deriveFullNameFromEmail(email: string | undefined): string {
    const localPart = email?.split('@')[0]?.trim();

    if (!localPart) {
      return '';
    }

    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private get accessExpiresInMs(): number {
    return durationToMs(process.env.JWT_ACCESS_EXPIRES_IN ?? '15m');
  }

  private get refreshExpiresInMs(): number {
    return durationToMs(process.env.JWT_REFRESH_EXPIRES_IN ?? '30d');
  }

  private get realtimeTokenTtlSeconds(): number {
    const configured = Number(process.env.SUPABASE_REALTIME_TOKEN_TTL_SECONDS);

    if (Number.isFinite(configured) && configured > 60) {
      return Math.floor(configured);
    }

    return DEFAULT_REALTIME_TOKEN_TTL_SECONDS;
  }

  private getRealtimePrivateJwk(): JsonWebKey & { kid: string } {
    const rawJwk = process.env.SUPABASE_REALTIME_PRIVATE_JWK;

    if (!rawJwk) {
      throw new ServiceUnavailableException(
        'Realtime notifications are not configured',
      );
    }

    try {
      const jwk = JSON.parse(rawJwk) as JsonWebKey & { kid?: string };

      if (
        jwk.kty !== 'EC' ||
        jwk.crv !== 'P-256' ||
        !jwk.d ||
        !jwk.x ||
        !jwk.y ||
        !jwk.kid
      ) {
        throw new Error('Invalid ES256 JWK');
      }

      return jwk as JsonWebKey & { kid: string };
    } catch {
      throw new ServiceUnavailableException(
        'Realtime notifications are not configured',
      );
    }
  }
}
