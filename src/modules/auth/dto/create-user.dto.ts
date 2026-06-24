import type { RoleName } from '../../../database/schema';

export class CreateUserDto {
  email!: string;
  password?: string;
  fullName?: string;
  role?: RoleName;
}
