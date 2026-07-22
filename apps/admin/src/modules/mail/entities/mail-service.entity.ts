import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'mail_services' })
export class MailServiceEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  host: string;

  @Column({ type: 'integer' })
  port: number;

  @Column({ type: 'boolean', default: true })
  secure: boolean;

  @Column({ type: 'varchar', length: 255 })
  username: string;

  @Column({ type: 'text', select: false })
  encryptedPassword: string;

  @Column({ type: 'varchar', length: 320 })
  fromAddress: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  createdByEmail: string;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
