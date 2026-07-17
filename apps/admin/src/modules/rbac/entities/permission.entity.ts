import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { Permission } from '@/common/rbac/permissions';

@Entity({ name: 'rbac_permissions' })
export class RbacPermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  code: Permission;

  @Column({ type: 'varchar', length: 60 })
  group: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  description: string;
}
