import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { FeedbackAttachmentEntity } from './feedback-attachment.entity';

@Entity({ name: 'user_feedback' })
@Index(['createdAt'])
export class FeedbackEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 40 })
  version: string;

  @Column({ type: 'varchar', length: 500 })
  platform: string;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastRepliedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lastRepliedById?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  lastRepliedByEmail?: string | null;

  @OneToMany(() => FeedbackAttachmentEntity, (attachment) => attachment.feedback, {
    cascade: ['insert'],
  })
  attachments: FeedbackAttachmentEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
