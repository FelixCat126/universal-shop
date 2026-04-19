#!/usr/bin/env node
/**
 * 生产环境部署后的数据库步骤：仅结构升级与缺失项补齐，不重置管理员密码、不覆盖业务数据。
 * 由 scripts/deploy-aliyun.sh 在服务器上调用。
 */
import DataSeeder from '../src/server/seeds/index.js'

await DataSeeder.runProductionUpdate()
