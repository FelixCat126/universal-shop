/**
 * 空字符串 → null 的归一化（第 50 轮）
 * ====================================
 *
 * ## 为什么需要
 *
 * 前端表单里"没填"的输入框，值是**空字符串 `''`**，不是 `null`。
 * 而 Sequelize 的模型校验只对 `null` / `undefined` 跳过（`allowNull: true`），
 * **空字符串照样进校验器**：
 *
 * ```js
 * email: {
 *   allowNull: true,
 *   validate: { isEmail: true }   // ← '' 会被判成"不是合法邮箱"
 * }
 * ```
 *
 * Sequelize 的 `_singleAttrValidate` 里只有这一句跳过逻辑：
 *
 * ```js
 * if (value === null || value === void 0) { return; }
 * ```
 *
 * `''` 不是 null → 走 `isEmail` → 失败 → 抛 ValidationError。
 *
 * ## 实际后果（不只是"多一个 400"）
 *
 * 运营在后台新建操作员，邮箱是**选填**（界面上写着"选填"）→ 前端提交 `email: ''`
 * → 后端 400「「email」格式不正确（应为邮箱地址）」→
 * **运营什么都没填错，却被告知邮箱格式不对**（提示指向了错误的字段）。
 *
 * 更糟的是 `email` 上有 **unique 约束**：就算把 `isEmail` 放宽让 `''` 存进去，
 * 第二个不填邮箱的操作员就会撞唯一键 → 又一个看不懂的报错。
 *
 * ## 现在的做法
 *
 * 在模型层（`beforeValidate`）把空字符串归一化成 `null`：
 *
 *   - 归一化发生在**校验之前** → `isEmail` 被正确跳过（语义：没填就是没填）
 *   - 存进库里的是 `null` 而不是 `''` → **不占唯一键**，多个"没填邮箱"互不冲突
 *   - **所有写入路径都自动受益**（创建 / 更新 / 批量导入 / 后台脚本），
 *     不需要在每个控制器里各写一遍 `email || null`
 *
 * 为什么放在 `beforeValidate` 而不是 `beforeSave`：
 * `beforeSave` 在校验**之后**才跑（save → validate → beforeSave），
 * 那时 ValidationError 已经抛出去了 —— 归一化必须发生在校验之前。
 */
export function emptyStringToNull (value) {
  if (value === '') return null
  return value
}

/**
 * 归一化"可选邮箱"字段：空字符串 → null，其余原样返回。
 *
 * @param {*} value 字段当前值
 * @returns {*} null 或原值
 */
export function normalizeOptionalEmail (value) {
  return emptyStringToNull(value)
}
