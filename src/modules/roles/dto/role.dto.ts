import type { PermissionScope } from '../../../common/auth/permissions';

export interface RolePermissionInput {
  key: string;
  scope: PermissionScope;
}

export class SaveRoleDto {
  name!: string;
  description?: string | null;
  permissions!: RolePermissionInput[];
  expectedRevision?: number;
}

export class ArchiveRoleDto {
  replacementRoleId!: string;
}
