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

@Entity({ name: 'synced_providers' })
@Index(['ownerId', 'providerId'], { unique: true })
export class SyncedProviderEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => UserEntity, (user) => user.syncedProviders, { onDelete: 'CASCADE' })
  owner: UserEntity;

  @Column({ type: 'varchar', length: 64 })
  providerId: string;

  @Column({ type: 'varchar', length: 24, default: 'custom' })
  kind: 'custom' | 'openai';

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  group: string;

  @Column({ type: 'varchar', length: 500 })
  baseUrl: string;

  @Column({ type: 'text' })
  apiKey: string;

  @Column({ type: 'varchar', length: 160 })
  model: string;

  @Column({ type: 'jsonb', default: [] })
  models: string[];

  @Column({ type: 'jsonb', default: {} })
  modelReasoningEfforts: Record<string, string[]>;

  @Column({ type: 'jsonb', default: {} })
  modelContextWindows: Record<string, number>;

  @Column({ type: 'jsonb', default: {} })
  modelApiFormats: Record<string, 'openaiResponses' | 'openaiChat'>;

  @Column({ type: 'jsonb', default: [] })
  imageInputModels: string[];

  @Column({ type: 'integer', nullable: true })
  contextWindow: number | null;

  @Column({ type: 'boolean', default: false })
  modelSelectionControlledByCodex: boolean;

  @Column({ type: 'boolean', default: false })
  fastModeEnabled: boolean;

  @Column({ type: 'varchar', length: 24 })
  apiFormat: 'openaiResponses' | 'openaiChat';

  @Column({ type: 'varchar', length: 24, nullable: true })
  balancePlatform: 'newApi' | 'sub2Api' | 'deepSeek' | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  balanceQueryUrl: string | null;

  @Column({ type: 'text', nullable: true })
  balanceQueryToken: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  walletQueryUrl: string | null;

  @Column({ type: 'text', nullable: true })
  walletQueryToken: string | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  walletUsername: string | null;

  @Column({ type: 'text', nullable: true })
  walletPassword: string | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastModifiedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  fieldModifiedAt: Record<string, string>;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
