import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RbacPermissionEntity } from './permission.entity';

@Entity({ name: 'rbac_roles' })
export class RbacRoleEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  description: string;

  @Column({ type: 'boolean', default: false })
  system: boolean;

  @ManyToMany(() => RbacPermissionEntity, { eager: true })
  @JoinTable({
    name: 'rbac_role_permissions',
    joinColumn: { name: 'roleCode', referencedColumnName: 'code' },
    inverseJoinColumn: { name: 'permissionCode', referencedColumnName: 'code' },
  })
  permissions: RbacPermissionEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
