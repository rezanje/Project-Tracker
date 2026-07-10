import { expect, test } from 'vitest'
import { assertApproved } from './auth'

test('approved profile passes through', () => {
  expect(() => assertApproved({ status: 'approved', is_super_admin: false })).not.toThrow()
})

test('pending non-admin profile redirects', () => {
  expect(() => assertApproved({ status: 'pending', is_super_admin: false })).toThrow()
})

test('super admin passes through even if pending', () => {
  expect(() => assertApproved({ status: 'pending', is_super_admin: true })).not.toThrow()
})
