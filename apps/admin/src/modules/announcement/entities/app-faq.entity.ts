import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'app_faqs' })
export class AppFaqEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 300 })
  questionZh: string;

  @Column({ type: 'varchar', length: 300 })
  questionEn: string;

  @Column({ type: 'text' })
  answerZh: string;

  @Column({ type: 'text' })
  answerEn: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
