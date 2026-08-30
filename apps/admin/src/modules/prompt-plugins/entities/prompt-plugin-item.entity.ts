import { randomUUID } from 'crypto';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type PromptPluginType = 'injection' | 'filter';

@Entity({ name: 'prompt_plugin_items' })
@Index(['uploaderId', 'name'], { unique: true })
@Index(['createdAt'])
export class PromptPluginItemEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 40 })
  version: string;

  @Column({ type: 'varchar', length: 16 })
  type: PromptPluginType;

  @Column({ type: 'text' })
  text: string;

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
