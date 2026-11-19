import DOMPurify from 'dompurify'

/** DOMPurify's default allowed-URI pattern, plus in-app `velocity:` links (plugins open them). */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|velocity):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i

/** Sanitize rendered note HTML: never render script, but keep `velocity://` links. */
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ALLOWED_URI_REGEXP })
}
