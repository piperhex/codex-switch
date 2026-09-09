import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateAnnouncementDto } from '@/modules/announcement/dto/update-announcement.dto';

const announcement = {
  contentZh: '通知', contentEn: 'Notice', link: '', enabled: true,
  textColor: '#008271', backgroundColor: '#CEFDEE', scrollDurationSeconds: 22,
};

describe('announcement dark color validation', () => {
  it('accepts hex colors and older requests without dark colors', () => {
    expect(validateSync(plainToInstance(UpdateAnnouncementDto, announcement))).toEqual([]);
    expect(validateSync(plainToInstance(UpdateAnnouncementDto, {
      ...announcement, darkTextColor: '#aAbBcC', darkBackgroundColor: '#102030',
    }))).toEqual([]);
  });

  it.each(['red', '#fff', '#11223344', '', null])('rejects invalid dark colors: %s', (color) => {
    const errors = validateSync(plainToInstance(UpdateAnnouncementDto, {
      ...announcement, darkTextColor: color, darkBackgroundColor: color,
    }));
    expect(errors.map((error) => error.property)).toEqual(['darkTextColor', 'darkBackgroundColor']);
  });
});
