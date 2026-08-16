import { randomUUID } from 'crypto';
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
import type { TotpEntryDto, TotpTombstoneDto } from '../dto/sync-totp.dto';

@Entity({ name: 'synced_totp_vaults' })
@Index(['ownerId'], { unique: true })
export class SyncedTotpVaultEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => UserEntity, (user) => user.syncedTotpVaults, { onDelete: 'CASCADE' })
  owner: UserEntity;

  @Column({ type: 'jsonb', default: [] })
  entries: TotpEntryDto[];

  @Column({ type: 'jsonb', default: [] })
  tombstones: TotpTombstoneDto[];

  @Column({ type: 'timestamptz' })
  modifiedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
