import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  ADMINISTRATOR_ROLE_NAME,
  type PermissionScope,
} from '../../common/auth/permissions';
import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import type { ArchiveRoleDto, SaveRoleDto } from './dto/role.dto';

type RoleGrant = {
  key: string;
  scope: PermissionScope;
};

@Injectable()
export class RolesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async listPermissions() {
    const permissions = await this.db
      .selectFrom('authentication.permissions')
      .selectAll()
      .orderBy('sort_order', 'asc')
      .execute();

    return {
      permissions: permissions.map((permission) => ({
        key: permission.key,
        module: permission.module,
        action: permission.action,
        label: permission.label,
        description: permission.description,
        supportsAssignedScope: permission.supports_assigned_scope,
        sortOrder: permission.sort_order,
      })),
    };
  }

  async listRoles() {
    const roles = await this.db
      .selectFrom('authentication.roles')
      .selectAll()
      .orderBy('archived_at', 'asc')
      .orderBy('name', 'asc')
      .execute();
    const roleIds = roles.map((role) => role.id);
    const grants = roleIds.length
      ? await this.db
          .selectFrom('authentication.role_permissions')
          .selectAll()
          .where('role_id', 'in', roleIds)
          .execute()
      : [];
    const userCounts = roleIds.length
      ? await this.db
          .selectFrom('authentication.users')
          .select(({ fn }) => [
            'role_id',
            fn.countAll<number>().as('user_count'),
          ])
          .where('role_id', 'in', roleIds)
          .groupBy('role_id')
          .execute()
      : [];

    return {
      roles: roles.map((role) =>
        this.serializeRole(
          role,
          grants
            .filter((grant) => grant.role_id === role.id)
            .map((grant) => ({
              key: grant.permission_key,
              scope: grant.scope as PermissionScope,
            })),
          Number(
            userCounts.find((count) => count.role_id === role.id)
              ?.user_count ?? 0,
          ),
        ),
      ),
    };
  }

  async getRole(id: string) {
    const role = await this.getRoleRecord(id);
    const grants = await this.getRoleGrants(id);
    const userCount = await this.countRoleUsers(id);

    return { role: this.serializeRole(role, grants, userCount) };
  }

  async createRole(currentUser: CurrentUser, dto: SaveRoleDto) {
    const name = this.normalizeName(dto.name);
    await this.ensureUniqueActiveName(name);
    const grants = await this.normalizeGrants(dto.permissions);

    const role = await this.db.transaction().execute(async (trx) => {
      const insertedRole = await trx
        .insertInto('authentication.roles')
        .values({
          name,
          description: this.normalizeDescription(dto.description),
          created_by_user_id: currentUser.id,
          updated_by_user_id: currentUser.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.replaceRoleGrants(trx, insertedRole.id, grants);
      return insertedRole;
    });

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: role.id,
      actionType: 'role.created',
      summary: `Role ${role.name} created`,
      metadata: { roleName: role.name, permissions: grants },
    });

    return { role: this.serializeRole(role, grants, 0) };
  }

  async updateRole(currentUser: CurrentUser, id: string, dto: SaveRoleDto) {
    const existingRole = await this.getRoleRecord(id);

    if (!existingRole.is_mutable) {
      throw new BadRequestException('This protected role cannot be edited');
    }

    if (
      typeof dto.expectedRevision === 'number' &&
      dto.expectedRevision !== existingRole.revision
    ) {
      throw new ConflictException(
        'This role was updated by another user. Refresh and try again.',
      );
    }

    const name = this.normalizeName(dto.name);
    await this.ensureUniqueActiveName(name, id);
    const grants = await this.normalizeGrants(dto.permissions);

    const updatedRole = await this.db.transaction().execute(async (trx) => {
      const role = await trx
        .updateTable('authentication.roles')
        .set({
          name,
          description: this.normalizeDescription(dto.description),
          updated_by_user_id: currentUser.id,
          revision: existingRole.revision + 1,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.replaceRoleGrants(trx, id, grants);
      return role;
    });

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: updatedRole.id,
      actionType: 'role.updated',
      summary: `Role ${updatedRole.name} updated`,
      metadata: { roleName: updatedRole.name, permissions: grants },
    });

    return {
      role: this.serializeRole(
        updatedRole,
        grants,
        await this.countRoleUsers(id),
      ),
    };
  }

  async archiveRole(
    currentUser: CurrentUser,
    id: string,
    dto: ArchiveRoleDto,
  ) {
    const role = await this.getRoleRecord(id);

    if (!role.is_mutable || role.name === ADMINISTRATOR_ROLE_NAME) {
      throw new BadRequestException('This protected role cannot be archived');
    }

    if (id === dto.replacementRoleId) {
      throw new BadRequestException('Choose a different replacement role');
    }

    const replacement = await this.getRoleRecord(dto.replacementRoleId);

    if (replacement.archived_at) {
      throw new BadRequestException('Replacement role must be active');
    }

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('authentication.users')
        .set({
          role_id: replacement.id,
          role: replacement.name === ADMINISTRATOR_ROLE_NAME ? 'admin' : 'staff',
          updated_at: new Date(),
        })
        .where('role_id', '=', id)
        .execute();

      await trx
        .updateTable('authentication.roles')
        .set({
          archived_at: new Date(),
          updated_by_user_id: currentUser.id,
          revision: role.revision + 1,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
    });

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: id,
      actionType: 'role.archived',
      summary: `Role ${role.name} archived`,
      metadata: {
        roleName: role.name,
        replacementRoleId: replacement.id,
        replacementRoleName: replacement.name,
      },
    });

    return { success: true };
  }

  async restoreRole(currentUser: CurrentUser, id: string) {
    const role = await this.getRoleRecord(id);

    await this.ensureUniqueActiveName(role.name, id);

    const restoredRole = await this.db
      .updateTable('authentication.roles')
      .set({
        archived_at: null,
        updated_by_user_id: currentUser.id,
        revision: role.revision + 1,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: currentUser,
      entityType: 'user',
      entityId: id,
      actionType: 'role.restored',
      summary: `Role ${role.name} restored`,
      metadata: { roleName: role.name },
    });

    return {
      role: this.serializeRole(
        restoredRole,
        await this.getRoleGrants(id),
        await this.countRoleUsers(id),
      ),
    };
  }

  async getActiveRoleOrThrow(id: string) {
    const role = await this.getRoleRecord(id);

    if (role.archived_at) {
      throw new BadRequestException('Role is archived');
    }

    return role;
  }

  private async getRoleRecord(id: string) {
    const role = await this.db
      .selectFrom('authentication.roles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!role) {
      throw new BadRequestException('Role not found');
    }

    return role;
  }

  private async getRoleGrants(id: string): Promise<RoleGrant[]> {
    const grants = await this.db
      .selectFrom('authentication.role_permissions')
      .select(['permission_key', 'scope'])
      .where('role_id', '=', id)
      .execute();

    return grants.map((grant) => ({
      key: grant.permission_key,
      scope: grant.scope as PermissionScope,
    }));
  }

  private async countRoleUsers(roleId: string): Promise<number> {
    const count = await this.db
      .selectFrom('authentication.users')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();

    return Number(count.count);
  }

  private async normalizeGrants(
    grants: SaveRoleDto['permissions'] | undefined,
  ): Promise<RoleGrant[]> {
    const requestedGrants = grants ?? [];
    const permissions = await this.db
      .selectFrom('authentication.permissions')
      .select(['key', 'supports_assigned_scope'])
      .execute();
    const permissionMap = new Map(
      permissions.map((permission) => [permission.key, permission]),
    );
    const normalized = new Map<string, PermissionScope>();

    for (const grant of requestedGrants) {
      const permission = permissionMap.get(grant.key);

      if (!permission) {
        throw new BadRequestException(`Unknown permission: ${grant.key}`);
      }

      if (grant.scope !== 'assigned' && grant.scope !== 'all') {
        throw new BadRequestException('permission scope must be assigned or all');
      }

      if (grant.scope === 'assigned' && !permission.supports_assigned_scope) {
        throw new BadRequestException(
          `${grant.key} does not support assigned-only scope`,
        );
      }

      normalized.set(grant.key, grant.scope);
    }

    return [...normalized.entries()].map(([key, scope]) => ({ key, scope }));
  }

  private async replaceRoleGrants(
    trx: Kysely<DB>,
    roleId: string,
    grants: RoleGrant[],
  ) {
    await trx
      .deleteFrom('authentication.role_permissions')
      .where('role_id', '=', roleId)
      .execute();

    if (grants.length === 0) {
      return;
    }

    await trx
      .insertInto('authentication.role_permissions')
      .values(
        grants.map((grant) => ({
          role_id: roleId,
          permission_key: grant.key,
          scope: grant.scope,
        })),
      )
      .execute();
  }

  private async ensureUniqueActiveName(name: string, ignoredRoleId?: string) {
    let query = this.db
      .selectFrom('authentication.roles')
      .select(['id'])
      .where('archived_at', 'is', null)
      .where(sql`lower(name)`, '=', name.toLowerCase());

    if (ignoredRoleId) {
      query = query.where('id', '!=', ignoredRoleId);
    }

    const existingRole = await query.executeTakeFirst();

    if (existingRole) {
      throw new BadRequestException(`Role ${name} already exists`);
    }
  }

  private normalizeName(name: string | undefined): string {
    const normalized = name?.trim().replace(/\s+/g, ' ');

    if (!normalized) {
      throw new BadRequestException('name is required');
    }

    return normalized;
  }

  private normalizeDescription(description: string | null | undefined) {
    const normalized = description?.trim();
    return normalized || null;
  }

  private serializeRole(role: {
    id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    is_mutable: boolean;
    archived_at: Date | null;
    revision: number;
    created_at: Date;
    updated_at: Date;
  }, permissions: RoleGrant[], userCount: number) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.is_system,
      isMutable: role.is_mutable,
      isAdministrator: role.name === ADMINISTRATOR_ROLE_NAME,
      archivedAt: role.archived_at?.toISOString() ?? null,
      revision: role.revision,
      userCount,
      permissions,
      createdAt: role.created_at.toISOString(),
      updatedAt: role.updated_at.toISOString(),
    };
  }
}
