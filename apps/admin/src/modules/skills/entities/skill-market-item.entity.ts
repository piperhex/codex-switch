import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'skill_market_items' })
@Index(['createdAt'])
export class SkillMarketItemEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 40 })
  version: string;

  @Column({ type: 'varchar', length: 255 })
  archiveFileName: string;

  @Column({ type: 'varchar', length: 80 })
  archiveMimeType: string;

  @Column({ type: 'integer' })
  archiveSize: number;

  @Column({ type: 'char', length: 64 })
  archiveSha256: string;

  @Column({ type: 'bytea', select: false })
  archiveData: Buffer;

  @Column({ type: 'varchar', length: 80, nullable: true })
  previewMimeType?: string | null;

  @Column({ type: 'integer', nullable: true })
  previewSize?: number | null;

  @Column({ type: 'bytea', nullable: true, select: false })
  previewData?: Buffer | null;

  @Column({ type: 'uuid', nullable: true })
  uploaderId?: string | null;

  @Column({ type: 'varchar', length: 160 })
  uploaderEmail: string;

  @Column({ type: 'integer', default: 0 })
  installCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
