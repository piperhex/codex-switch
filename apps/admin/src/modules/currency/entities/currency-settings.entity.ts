import {
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  Entity,
} from 'typeorm';

export interface CurrencySettingItem {
  code: string;
  name: string;
}

@Entity({ name: 'currency_settings' })
export class CurrencySettingsEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'text', nullable: true, select: false })
  encryptedApiKey?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  currencies: CurrencySettingItem[];

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
