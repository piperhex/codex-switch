import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { FeedbackEntity } from './feedback.entity';

@Entity({ name: 'user_feedback_attachments' })
@Index(['feedbackId'])
export class FeedbackAttachmentEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  feedbackId: string;

  @ManyToOne(() => FeedbackEntity, (feedback) => feedback.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feedbackId' })
  feedback: FeedbackEntity;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'varchar', length: 80 })
  mimeType: string;

  @Column({ type: 'integer' })
  size: number;

  @Column({ type: 'bytea', select: false })
  data: Buffer;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
