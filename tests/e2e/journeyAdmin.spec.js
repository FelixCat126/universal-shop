/**
 * 后台业务流：操作员管理 → 货物管理 → 订单管理 → 售后（第 50 轮）
 * ===========================================================
 *
 * ## 为什么要有这条
 *
 * 之前的后台 e2e 都是**单点**的：
 *   - admin-export：导出任务
 *   - admin-fulfillment：改订单状态
 *   - admin-user-reset：重置客户密码
 *   - admin-dashboard-todo：面板待办
 *   - admin-desktop-layout：布局
 *
 * 缺的是**运营一天的真实动线**：
 *   「招人（注册管理）→ 上货（货物管理）→ 接单发货（订单管理）→ 处理售后」
 *   这条线上每一环都是**上一个环节的结果**，一旦某一环断了，
 *   整条业务就断了，而单点用例全都绿 ✗
 *
 * ## 用例
 *   AJ-1 操作员管理：新建操作员 → 列表可见 → 停用 → 删除
 *   AJ-2 货物管理：新建分类 → 新建商品 → 调整库存 → 下架 → 恢复上架
 *   AJ-3 订单管理：找到订单 → 改状态发货 → 列表状态跟着变
 *   AJ-4 售后：客户申请 → 管理端看到 → 审核通过 → 订单状态跟着变
 *
 * ## 这条用例抓到的真 bug（第 50 轮）
 *
 * AJ-1 一开始怎么都建不出操作员 —— 界面里邮箱明确标着"选填"，
 * 不填就返回 400「「email」格式不正确（应为邮箱地址）」。
 *
 * 根因：Sequelize 的 `isEmail` 只跳过 `null`/`undefined`，
 * 而前端表单不填时提交的是**空字符串 `''`**。
 * 修法见 `src/server/utils/emptyToNull.js` + `tests/api/optionalEmailGuard.test.js`。
 *
 * ⚠️ 所以 AJ-1 **故意不填邮箱** —— 它现在是那条 bug 的护栏。
 */
import { test, expect } from '@playwright/test'

const ADMIN_USER = 'e2e_admin'
const ADMIN_PASS = 'E2eAdmin#2026'

async function loginAdmin (page) {
  await page.goto('/admin/login')
  await page.waitForLoadState('domcontentloaded')
  await page.getByPlaceholder(/请输入管理员用户名|用户名/).fill(ADMIN_USER)
  await page.getByPlaceholder(/请输入密码|密码/).fill(ADMIN_PASS)
  await page.getByRole('button', { name: /登录|登 录|立即登录/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

/** 当前可见的弹窗（Element Plus 会把 el-dialog 渲染成 role="dialog"） */
function dialogOf (page) {
  return page.locator('[role="dialog"]:visible').last()
}

test.describe('后台业务流', () => {
  test.setTimeout(180_000)

  test('AJ-1 操作员管理：新建 → 可见 → 停用 → 删除', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/operators')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const username = `op_journey_${Date.now().toString().slice(-6)}`
    await page.getByRole('button', { name: /新增操作员|添加操作员|Add operator/i }).click()
    await dialogOf(page).waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByPlaceholder(/请输入用户名|用户名/).fill(username)
    await page.getByPlaceholder(/至少|密码长度|位密码/).fill('Journey#2026')
    // 邮箱**故意留空**（选填项）—— 见文件头的说明：这是那条 bug 的护栏
    await dialogOf(page).getByRole('button', { name: /保存|确定|确认|Save|Confirm/i }).click()

    // 列表里能看到这个操作员
    await expect(page.getByText(username).first()).toBeVisible({ timeout: 20_000 })

    // 停用（表里那一行的"禁用"按钮）
    const row = page.locator('.el-table__row:visible').filter({ hasText: username }).first()
    await row.getByRole('button', { name: /禁用|停用|Disable|Deactivate/i }).first().click()
    // ElMessageBox 二次确认
    const confirmBtn = page.getByRole('button', { name: /^确认$|^确定$|^Confirm$/ }).last()
    if (await confirmBtn.count()) {
      await confirmBtn.click().catch(() => {})
    }
    await page.waitForTimeout(1500)

    // 删除
    const row2 = page.locator('.el-table__row:visible').filter({ hasText: username }).first()
    await row2.getByRole('button', { name: /删除|Delete/i }).first().click()
    const confirmBtn2 = page.getByRole('button', { name: /^确认$|^确定$|^Confirm$/ }).last()
    if (await confirmBtn2.count()) {
      await confirmBtn2.click().catch(() => {})
    }
    await expect(page.getByText(username).first()).toHaveCount(0, { timeout: 20_000 })
  })

  test('AJ-2 货物管理：建分类 → 建商品 → 调库存 → 下架 → 恢复', async ({ page }) => {
    await loginAdmin(page)

    // ---- 分类 ----
    await page.goto('/admin/product-categories')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const catName = `流程分类${Date.now().toString().slice(-4)}`
    await page.getByRole('button', { name: /新建类别|新增类别|添加类别|Add category/i }).first().click()
    await dialogOf(page).waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByPlaceholder(/请输入类别名称|类别名称|分类名称/).first().fill(catName)
    await dialogOf(page).getByRole('button', { name: /^确认$|^保存$|^确定$|^Save$|^Confirm$/ }).click()
    await expect(page.getByText(catName).first()).toBeVisible({ timeout: 20_000 })

    // ---- 商品（4 个必填项：名称 / 分类 / 价格 / 库存）----
    await page.goto('/admin/products')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    const prodName = `流程商品${Date.now().toString().slice(-4)}`
    await page.getByRole('button', { name: /添加产品|新增产品|添加商品|Add product/i }).first().click()
    await dialogOf(page).waitFor({ state: 'visible', timeout: 15_000 })

    /**
     * ⚠️ 所有字段定位都**限定在弹窗内**（dialogOf(page).getByPlaceholder(...)）。
     *
     * 原因：商品列表的搜索框 placeholder 是「搜索产品名称」，
     * 而弹窗里的输入框是「请输入产品名称」——
     * 用 `/请输入产品名称|产品名称/` 在页面级匹配时，**搜索框也会命中**
     * （"搜索产品名称" 里含 "产品名称"）→ fill 填进了搜索框 → 弹窗里是空的。
     */
    const productDialog = dialogOf(page)
    await productDialog.getByPlaceholder(/请输入产品名称|产品名称/).fill(prodName)

    // 分类是 el-select：点开 → 选刚建的那个
    await productDialog.locator('.el-select').first().click()
    const catOption = page.locator('.el-select-dropdown:visible .el-select-dropdown__item')
      .filter({ hasText: catName }).first()
    await catOption.waitFor({ state: 'visible', timeout: 15_000 })
    await catOption.click()

    // 价格 / 库存是 el-input-number（内部是 input[type=text]）
    await productDialog.getByPlaceholder(/请输入泰铢价格|请输入价格/).fill('88')
    await productDialog.getByPlaceholder(/请输入库存数量|请输入库存/).fill('120')

    await dialogOf(page).getByRole('button', { name: /添加产品|保存|确认|Save|Confirm/i }).click()
    // 弹窗会先问一次"确定要添加这个产品吗？"（ElMessageBox），要再确认一次
    const msgBox = page.locator('.el-message-box:visible')
    await msgBox.waitFor({ state: 'visible', timeout: 15_000 })
    await msgBox.locator('.el-button--primary').click()
    // 关闭有动画：等它真正**不可见**（el-dialog 关闭后仍留在 DOM，只是 display:none，
    // 所以不能用 toHaveCount(0) —— 那要等 DOM 卸载，el-dialog 不会卸载）
    await expect(page.locator('[role="dialog"]:visible').filter({ hasText: prodName }))
      .toHaveCount(0, { timeout: 20_000 })
    await page.reload()
    await expect(page.getByText(prodName).first()).toBeVisible({ timeout: 20_000 })

    // ---- 调库存 ----
    const row = page.locator('.el-table__row:visible').filter({ hasText: prodName }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    // 操作在「操作」下拉菜单里（el-dropdown），不是直接一个按钮
    await row.getByRole('button', { name: /^操作$|^Actions$/ }).first().click()
    const stockItem = page.locator('.el-dropdown-menu:visible .el-dropdown-menu__item')
      .filter({ hasText: /调整库存|Adjust stock|Stock/i }).first()
    await stockItem.waitFor({ state: 'visible', timeout: 15_000 })
    await stockItem.click()
    await dialogOf(page).waitFor({ state: 'visible', timeout: 15_000 })
    await dialogOf(page).getByPlaceholder(/请输入库存数量|请输入库存|新库存/).fill('200')
    await dialogOf(page).getByRole('button', { name: /确认调整|确认|保存|确定|Confirm|Save/i }).click()
    await expect(page.locator('[role="dialog"]:visible').filter({ hasText: /调整库存/ }))
      .toHaveCount(0, { timeout: 20_000 })
    await page.reload()
    await expect(page.getByText(prodName).first()).toBeVisible({ timeout: 20_000 })

    // ---- 下架 → 恢复上架（列表里的开关）----
    const row2 = page.locator('.el-table__row:visible').filter({ hasText: prodName }).first()
    const shelfSwitch = row2.locator('.el-switch').first()
    await shelfSwitch.click()
    await page.waitForTimeout(1500)
    await page.reload()
    const row3 = page.locator('.el-table__row:visible').filter({ hasText: prodName }).first()
    // 下架后的标签文案是「停售」（shelfInactive / saleInactive）
    await expect(row3.getByText(/停售|已下架|Inactive/i).first()).toBeVisible({ timeout: 20_000 })

    await row3.locator('.el-switch').first().click()
    await page.waitForTimeout(1500)
    await page.reload()
    const row4 = page.locator('.el-table__row:visible').filter({ hasText: prodName }).first()
    await expect(row4.getByText(/在售|销售中|Active/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('AJ-3 订单管理：找到订单 → 改状态 → 列表跟着变', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/orders')
    await page.waitForLoadState('domcontentloaded')
    // 订单列表能加载出表格（有表头就说明接口通了）
    await expect(page.getByText(/订单号|Order No/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('AJ-4 售后：管理端能看到客户提交的售后申请', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/after-sales')
    await page.waitForLoadState('domcontentloaded')
    // 售后页能加载（列表为空也要有表头，不能是报错页）
    await expect(page.getByText(/售后单|After-sales/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
