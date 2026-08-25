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

  @Column({ name: 'encrypted_api_key', type: 'text', nullable: true, select: false })
  encryptedApiKey?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  currencies: CurrencySettingItem[];

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ name: 'updated_by_email', type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
