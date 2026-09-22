import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Hourly counters contain no chat content, user IDs, or device IDs. */
@Entity({ name: 'chat_relay_traffic' })
export class ChatTrafficEntity {
  @PrimaryColumn({ name: 'hour_start', type: 'timestamptz' })
  hourStart: Date;

  @PrimaryColumn({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @Column({ type: 'bigint', default: 0 })
  bytes: string;
}
