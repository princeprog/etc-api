import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { ADMINISTRATOR_ROLE_NAME } from '../../common/auth/permissions';
import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';

@Injectable()
export class LeadAssignmentService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async resolveCreateAssignee(
    user: CurrentUser,
    requestedAssigneeUserId: string | null | undefined,
  ) {
    if (!user.isAdministrator) {
      return user.id;
    }

    const assigneeUserId = requestedAssigneeUserId?.trim();

    if (!assigneeUserId) {
      throw new BadRequestException(
        'assigneeUserId is required when an admin creates a lead',
      );
    }

    const assignee = await this.db
      .selectFrom('authentication.users')
      .innerJoin(
        'authentication.roles',
        'authentication.roles.id',
        'authentication.users.role_id',
      )
      .select([
        'authentication.users.id as id',
        'authentication.users.active as active',
        'authentication.users.must_change_password as mustChangePassword',
        'authentication.roles.name as roleName',
        'authentication.roles.archived_at as roleArchivedAt',
      ])
      .where('authentication.users.id', '=', assigneeUserId)
      .executeTakeFirst();

    if (
      !assignee ||
      !assignee.active ||
      assignee.mustChangePassword ||
      assignee.roleName === ADMINISTRATOR_ROLE_NAME ||
      assignee.roleArchivedAt
    ) {
      throw new BadRequestException(
        'Assigned user must be an active staff member with password setup completed',
      );
    }

    return assignee.id;
  }
}
