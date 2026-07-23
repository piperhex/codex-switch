import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '@/modules/user/entities/user.entity';

@Entity({ name: 'remote_devices' })
@Index(['ownerId', 'name'])
export class RemoteDeviceEntity {
  @PrimaryColumn({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  owner: UserEntity;

  @PrimaryColumn({ type: 'uuid' })
  deviceId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  appVersion: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  activeAccountId: string | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
