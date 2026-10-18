import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from './testing'
import { getSettings, saveSettings } from './settings'

describe('settings', () => {
  it('saves family settings (admin only, validated)', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveSettings(doc, admin, { family_name: 'The Smiths', week_start_day: 'monday' })
    expect(getSettings(doc)).toMatchObject({ family_name: 'The Smiths', week_start_day: 'monday' })
    expect(() => saveSettings(doc, admin, { family_name: 'x', week_start_day: 'friday' })).toThrow('week_start_day must be sunday or monday')
    expect(() => saveSettings(doc, kid, { family_name: 'x', week_start_day: 'sunday' })).toThrow('Only an admin can do that')
  })

  it('a new family starts on the coral theme', () => {
    const { doc } = newFamilyDoc()
    expect(getSettings(doc).theme.color_theme).toBe('coral')
  })

  it('has no per-family module list: every module is available to every family', () => {
    const { doc } = newFamilyDoc()
    expect(getSettings(doc)).not.toHaveProperty('modules_enabled')
  })
})
