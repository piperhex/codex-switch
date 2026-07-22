import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MailServiceEntity } from '@/modules/mail/entities/mail-service.entity';

@Entity({ name: 'email_templates' })
export class EmailTemplateEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  code: string;

  @Column({ type: 'varchar', length: 300 })
  subject: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'uuid', nullable: true })
  mailServiceId?: string | null;

  @ManyToOne(() => MailServiceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'mailServiceId' })
  mailService?: MailServiceEntity | null;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
