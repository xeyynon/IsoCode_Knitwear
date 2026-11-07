import { describe, expect, it } from 'vitest'
import { alertTime, channelLabel, recipientLabel } from '../src/setup/alertLogic'

describe('when an alert was made', () => {
  it('shows Indian time, whatever the viewer\'s own zone', () => {
    expect(alertTime('2026-11-04T04:30:00Z')).toBe('4 Nov, 10:00')
    expect(alertTime('2026-11-04T20:00:00Z')).toBe('5 Nov, 01:30')    // past midnight in India: the next day
    expect(alertTime('2026-12-31T19:00:00Z')).toBe('1 Jan, 00:30')
  })
  it('shows a dash for something that is not a time', () => {
    expect(alertTime('')).toBe('-')
    expect(alertTime('yesterday')).toBe('-')
  })
})

describe('labels', () => {
  it('names the channel', () => {
    expect(channelLabel('email')).toBe('Email')
    expect(channelLabel('whatsapp')).toBe('WhatsApp')
  })
  it('says who it was for', () => {
    expect(recipientLabel('buyer', 'Buyer B')).toBe('Buyer B (buyer)')
    expect(recipientLabel('merchandiser', 'Merchandisers')).toBe('Merchandisers')
  })
})
