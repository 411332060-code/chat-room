import { MAX_LENGTH, MAX_NAME_LENGTH, type ChatErrorCode, type Message } from '../types'

export type ParseResult = { ok: true; content: string } | { ok: false; code: ChatErrorCode }

// Control characters (except newline), zero-width characters, bidi controls, BOM.
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate and tidy a message before it is sent. The database repeats the checks. */
export function parsePost(raw: string): ParseResult {
  const content = raw
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (content.length === 0) return { ok: false, code: 'EMPTY' }
  if ([...content].length > MAX_LENGTH) return { ok: false, code: 'TOO_LONG' }
  return { ok: true, content }
}

/**
 * Tidy a nickname the visitor typed. Returns null when nothing usable is left
 * (the service then picks a random one). The database cleans it again.
 */
export function parseNickname(raw: string): string | null {
  const name = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  const cut = [...name].slice(0, MAX_NAME_LENGTH).join('').trim()
  return cut === '' ? null : cut
}

/** Check the shape of a message that arrived from someone else, before it is shown. */
export function isValidMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    UUID.test(m.id) &&
    typeof m.authorId === 'string' &&
    typeof m.nickname === 'string' &&
    m.nickname.length > 0 &&
    typeof m.content === 'string' &&
    m.content.length > 0 &&
    [...m.content].length <= MAX_LENGTH &&
    typeof m.createdAt === 'string' &&
    !Number.isNaN(Date.parse(m.createdAt))
  )
}
