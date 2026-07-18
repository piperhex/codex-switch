import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'announcement_link_clicks' })
@Index(['deviceId', 'createdAt'])
@Index(['platform', 'createdAt'])
@Index(['createdAt'])
export class AnnouncementLinkClickEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  deviceId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 2048 })
  link: string;

  @Column({ type: 'timestamptz', nullable: true })
  announcementUpdatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
