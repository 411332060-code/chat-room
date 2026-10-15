import { MAX_LENGTH, type ChatErrorCode } from '../types'

export type ParseResult = { ok: true; content: string } | { ok: false; code: ChatErrorCode }

// Control characters (except newline), zero-width characters, bidi controls, BOM.
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g

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
