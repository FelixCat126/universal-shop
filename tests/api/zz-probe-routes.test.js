import { describe, it, expect } from 'vitest'
import app from '@server/app.js'

function collectRoutes (stack, prefix = '') {
  const out = []
  for (const layer of stack) {
    if (layer.route) {
      const path = prefix + layer.route.path
      const methods = Object.keys(layer.route.methods || {})
      out.push({ path, methods, stack: layer.route.stack })
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const src = layer.regexp?.source || ''
      const m = /^\^\\\/(.*?)\\\//.exec(src)
      let seg = ''
      if (m) seg = '/' + m[1].replace(/\\\//g, '/').replace(/\\\./g, '.')
      out.push(...collectRoutes(layer.handle.stack, prefix + seg))
    }
  }
  return out
}

describe('probe 路由清单', () => {
  it('列出来', () => {
    const routes = collectRoutes(app._router.stack)
    const writes = routes.filter(r => r.methods.some(m => ['post', 'put', 'patch'].includes(m)))
    console.log('总路由 ' + routes.length + '，写路由 ' + writes.length)
    for (const r of writes) console.log('  ' + r.methods.join(',').toUpperCase() + ' ' + r.path)
    expect(true).toBe(true)
  })
})
