import fs from 'node:fs'

const p = 'src/server/constants/revenueStatus.js'
let s = fs.readFileSync(p, 'utf8')

const broken = 'AND payment_method S IN (${methods})'
const fixed = 'AND payment_method NOT IN (${methods})'

if (!s.includes(broken)) {
  console.log('❌ 没找到损坏的那段')
  process.exit(1)
}
s = s.replace(broken, fixed)
fs.writeFileSync(p, s)
console.log('✅ 已修正')
