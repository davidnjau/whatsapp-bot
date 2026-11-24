import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { safeEqual } from '../lib/crypto.js'

export const SESSION_COOKIE = 'admin_session'

export function requireWebAuth(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const cookie = req.cookies[SESSION_COOKIE]
  if (cookie) {
    const { valid, value } = req.unsignCookie(cookie)
    if (valid && value === 'ok') {
      done()
      return
    }
  }
  void reply.redirect('/admin/login')
}

export function requireApiAuth(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : ((req.headers['x-api-key'] as string | undefined) ?? '')
  if (!token || !safeEqual(token, config.adminApiToken)) {
    void reply.code(401).send({ error: 'unauthorized' })
    return
  }
  done()
}

export function checkAdminCredentials(username: string, password: string): boolean {
  return safeEqual(username, config.adminUsername) && safeEqual(password, config.adminPassword)
}
