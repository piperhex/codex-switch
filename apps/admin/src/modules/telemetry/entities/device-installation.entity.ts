import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'device_installations' })
export class DeviceInstallationEntity {
  @PrimaryColumn({ type: 'uuid' })
  deviceId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @CreateDateColumn({ type: 'timestamptz' })
  firstSeenAt: Date;
}
