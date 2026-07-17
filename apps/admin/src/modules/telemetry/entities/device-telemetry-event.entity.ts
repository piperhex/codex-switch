import { randomUUID } from 'crypto';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'device_telemetry_events' })
@Index(['deviceId', 'createdAt'])
@Index(['eventType', 'createdAt'])
export class DeviceTelemetryEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  deviceId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 40 })
  eventType: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
