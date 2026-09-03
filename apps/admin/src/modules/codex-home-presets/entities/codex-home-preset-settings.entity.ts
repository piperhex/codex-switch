import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export interface CodexHomePresetItem {
  id: string;
  name: string;
  windowsPath: string;
  macosPath: string;
  enabled: boolean;
  sortOrder: number;
}

@Entity({ name: 'codex_home_preset_settings' })
export class CodexHomePresetSettingsEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  presets: CodexHomePresetItem[];

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ name: 'updated_by_email', type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
