/**
 * 001_baseline —— 迁移体系的基线标记
 *
 * 到这一版为止，结构变更都是靠 schemaEnsures.js 里一串幂等的 ensure*
 * （ALTER TABLE ADD COLUMN ...）完成的，没有顺序、没有记录、不能回滚。
 *
 * 从这条迁移开始，**结构变更一律走 migrations/**：
 *   - 新增一个 002_xxx.js，按序号自动执行
 *   - 执行过的记录写进 schema_migrations 表
 *   - 写了 down() 就能回滚（回滚会删记录，允许重跑）
 *
 * 这条本身不改结构，只作为基线锚点：把已有库标记成「迁移体系已接管」。
 */

export default {
  name: '001_baseline',
  async up () {
    // 无 DDL：此前的结构由 sequelize.sync + schemaEnsures 保证
  },
  async down () {
    // 无 DDL 可回滚
  }
}
