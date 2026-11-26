<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 主内容区域 -->
    <main
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
    >
      <!-- 页面标题 -->
      <div v-if="!homeBanner" class="mb-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">
          {{ t('product.productList') }}
        </h2>
        <p class="text-gray-600">
          {{ t('product.listSubtitle') }}
        </p>
      </div>

      <!-- 首页长图（滚动视差：banner 比内容滚动慢 30%） -->
      <div v-if="homeBanner" class="mb-6">
        <div
          v-motion-parallax="{ from: 0, to: 1, translateY: [0, 30] }"
          class="w-full max-w-4xl mx-auto overflow-hidden rounded-lg"
        >
          <img
            :src="getImageUrl(homeBanner)"
            alt="首页横幅"
            class="w-full h-auto rounded-lg shadow-sm object-cover"
            style="max-height: 300px;"
            @error="handleBannerError"
          >
        </div>
      </div>
      
      <!-- 组合套餐区块（无套餐时整块隐藏，不干扰商品列表） -->
      <section v-if="bundlesLoading || bundles.length > 0" class="mb-8">
        <h2 class="text-xl font-bold text-gray-900 mb-4">
          {{ t('bundle.sectionTitle') }}
        </h2>

        <!-- 套餐加载中：骨架屏 -->
        <div
          v-if="bundlesLoading && !bundles.length"
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch"
        >
          <SkeletonCard v-for="i in 4" :key="`bundle-sk-${i}`" />
        </div>

        <div
          v-else
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch"
        >
          <div
            v-for="(bundle, idx) in bundles"
            :key="bundle.id"
            v-motion
            :initial="{ opacity: 0, y: 20, scale: 0.96 }"
            :enter="{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { ...appleSpring, delay: Math.min(idx * 50, 500) }
            }"
            :hovered="{ scale: 1.04, transition: subtleSpring }"
            :tap="{ scale: 0.97, transition: bouncySpring }"
            class="bg-white rounded-xl shadow-sm hover:shadow-lg flex flex-col h-full min-h-0 transition-shadow duration-300"
          >
            <div class="aspect-square w-full bg-gray-200 rounded-t-xl overflow-hidden relative shrink-0">
              <span class="absolute left-2 top-2 z-10 px-2 py-0.5 text-xs font-medium bg-purple-600 text-white rounded">
                {{ t('bundle.badge') }}
              </span>
              <ImageFade
                :src="bundle.image || defaultImage"
                :srcset="imageSrcSet(bundle.image)"
                :alt="getCurrentLanguageValue(bundle, 'name')"
                custom-class="w-full h-48 object-cover"
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 50vw, 25vw"
                loading="lazy"
                @error="handleImageError"
                @load="handleImageLoad"
              />
            </div>

            <div class="p-4 flex flex-col flex-1 min-h-0">
              <h3 class="text-lg font-semibold text-gray-900 mb-1 line-clamp-2">
                {{ getCurrentLanguageValue(bundle, 'name') }}
              </h3>

              <!-- 组件摘要：A×1 + B×2 -->
              <p class="text-gray-500 text-xs mb-3 line-clamp-2 shrink-0">
                {{ bundleItemsSummary(bundle) }}
              </p>

              <div class="mt-auto pt-2 border-t border-gray-100">
                <div class="mb-3 space-y-1">
                  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span class="text-xl font-bold text-blue-600">
                      {{ portalCurrency.formatThb(Number(bundle.price)) }}
                    </span>
                    <span
                      v-if="bundleSave(bundle) > 0"
                      class="px-1.5 py-0.5 text-xs bg-red-100 text-red-600 rounded"
                    >
                      {{ t('bundle.save', { amount: portalCurrency.formatThb(bundleSave(bundle)) }) }}
                    </span>
                  </div>
                  <div v-if="bundleSave(bundle) > 0" class="text-xs text-gray-400">
                    {{ t('bundle.standaloneTotal') }}
                    <span class="line-through">{{ portalCurrency.formatThb(Number(bundle.standalone_total)) }}</span>
                  </div>
                  <div
                    class="text-xs tabular-nums"
                    :class="Number(bundle.available_stock) > 0 ? 'text-green-600' : 'text-red-600'"
                  >
                    <template v-if="Number(bundle.available_stock) > 0">
                      {{ t('bundle.stockLeft', { count: bundle.available_stock }) }}
                    </template>
                    <template v-else>
                      {{ t('bundle.soldOut') }}
                    </template>
                  </div>
                </div>

                <button
                  @click.stop="addBundle(bundle)"
                  :disabled="!(Number(bundle.available_stock) > 0)"
                  class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {{ t('product.addToCart') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 搜索栏：移动端全宽，桌面加宽与容器更协调 -->
      <div class="mb-6">
        <div class="relative w-full sm:max-w-xl">
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('product.searchPlaceholder')"
            :aria-label="t('product.searchPlaceholder')"
            class="w-full min-w-0 pl-10 pr-10 py-2 min-h-[44px] border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
            @keydown.enter.prevent="searchNow"
            @keydown.esc.prevent="clearSearch"
          >
          <svg class="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 shrink-0 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <!-- 搜索中：输入框内的转圈（比"结果突然变了"友好得多） -->
          <span
            v-if="searching"
            class="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin"
            role="status"
            :aria-label="t('product.searching')"
          />
          <!-- 清除：Esc 或点 × -->
          <button
            v-else-if="searchQuery"
            type="button"
            class="absolute right-2.5 top-1/2 transform -translate-y-1/2 h-6 w-6 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center"
            :aria-label="t('product.clearSearch')"
            @click="clearSearch"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 搜索结果数：搜的时候告诉用户"命中多少"，避免"结果没变"被误读成没搜到 -->
      <p
        v-if="searchQuery && !searching"
        class="mb-4 text-sm text-gray-500"
        role="status"
        aria-live="polite"
      >
        {{ t('product.searchResultCount', { count: searchTotal }) }}
      </p>

      <!-- 分类 Tab：横向滑动仅滚动本区域；下移出视口时粘在视窗顶部 -->
      <div
        v-if="categories.length"
        class="sticky top-0 z-30 -mx-4 mb-5 px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 bg-gray-50/95 backdrop-blur-md border-b border-gray-200/90 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      >
        <div
          ref="categoryTabScroller"
          class="flex gap-2 overflow-x-auto overflow-y-hidden pb-1 -mx-1 px-1 touch-pan-x [scrollbar-width:thin] category-tab-scroll"
          :class="{ 'cat-fade-right': categoryTabFadeRight, 'cat-fade-left': categoryTabFadeLeft }"
          @scroll.passive="updateCategoryTabFade"
        >
          <button
            v-for="c in categoryTabs"
            :key="c.id == null ? '__all__' : c.id"
            type="button"
            class="shrink-0 px-3 py-2.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium border transition-colors whitespace-nowrap min-h-[40px] sm:min-h-0"
            :class="selectedCategoryId === c.id
              ? 'bg-blue-600 text-white border-blue-600 shadow'
              : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'"
            @click="selectCategory(c.id)"
          >
            {{ c.name }}
          </button>
        </div>
      </div>

      <!-- 商品列表区：左右滑动切换分类（Tab 条自身仅横向滚动，不绑此手势） -->
      <section
        class="product-swipe-zone min-h-[8rem] touch-pan-y"
        @touchstart.passive="onProductAreaTouchStart"
        @touchend.passive="onProductAreaTouchEnd"
      >
      <!-- 首次加载：骨架屏替代 spinner -->
      <div
        v-if="isLoading && !products.length"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch"
      >
        <SkeletonCard v-for="i in 8" :key="`sk-${i}`" />
      </div>

      <!-- 产品网格（卡片等高，按钮贴底；spring 弹簧入场仅第一页前 8 张，其余 CSS 简单 fade-in） -->
      <div
        v-else-if="products.length > 0"
        class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch"
      >
        <!--
          商品卡用真 <a href> 而不是 <div @click>（第 54 轮）。
          原因：爬虫靠 DOM 里的 <a href> 构建链接图。原来这里是 <div @click>，
          **整个首页 DOM 里一个商品链接都没有** → 爬虫无法发现任何商品页
          （唯一入链是其它商品详情页的"相关推荐"，索引库空时连第一个都发现不了）。

          @click.prevent 保留 SPA 跳转（不整页刷新），
          而 JS 禁用时 <a href> 依然可用 —— 渐进增强。
        -->
        <a
          v-for="(product, idx) in products"
          :key="product.id"
          :href="`/portal/products/${product.id}`"
          @click.prevent="goToProductDetail(product.id)"
          v-motion
          :initial="shouldAnimateCard(idx) ? { opacity: 0, y: 20, scale: 0.96 } : undefined"
          :enter="shouldAnimateCard(idx) ? {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { ...appleSpring, delay: Math.min(idx * 50, 400) }
          } : undefined"
          :hovered="isDesktop ? { scale: 1.04, transition: subtleSpring } : undefined"
          :tap="{ scale: 0.97, transition: bouncySpring }"
          :class="[
            'bg-white rounded-xl shadow-sm hover:shadow-lg cursor-pointer flex flex-col h-full min-h-0 transition-shadow duration-300',
            shouldAnimateCard(idx) ? '' : 'css-card-fade-in'
          ]"
        >
          <div class="aspect-square w-full bg-gray-200 rounded-t-xl overflow-hidden relative shrink-0">
            <div
              v-if="product.points > 0"
              class="pointer-events-none absolute right-0 top-0 z-10 h-16 w-16 select-none overflow-visible"
              role="presentation"
            >
              <!-- 直角在图片右上角、沿右下与左上的斜边为斜边的三角区 -->
              <div
                aria-hidden="true"
                class="absolute inset-0 shadow-[2px_3px_10px_rgba(0,0,0,0.28)] [clip-path:polygon(100%_0,100%_100%,0_0)]"
              >
                <div class="absolute inset-0 bg-gradient-to-br from-amber-500 via-amber-600 to-amber-950" />
                <div class="absolute inset-0 bg-gradient-to-tl from-white/10 to-transparent" />
                <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/25" />
              </div>
              <span
                class="absolute left-[67%] top-[31%] z-[1] inline-block min-w-max -translate-x-1/2 -translate-y-1/2 rotate-45 origin-center text-[11px] font-extrabold uppercase leading-none tracking-normal text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)] whitespace-nowrap [word-break:keep-all] antialiased xs:text-[12px]"
              >
                {{ t('product.pointsExchangeBadge') }}
              </span>
            </div>
            <ImageFade
              :src="product.image_url || defaultImage"
              :srcset="imageSrcSet(product.image_url)"
              :alt="getCurrentLanguageValue(product, 'name')"
              custom-class="w-full h-48 object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 50vw, 25vw"
              :loading="cardLoading(idx).loading"
              :fetchpriority="cardLoading(idx).fetchpriority"
              @error="handleImageError"
              @load="handleImageLoad"
            />
          </div>
          
          <div class="p-4 flex flex-col flex-1 min-h-0">
            <!--
              标题/描述不再预留固定高度：预留会在"标题只有一行"时留下空洞
              （短标题的卡片下方出现一整块空白）。
              卡片等高由 grid 的 items-stretch + 价格区的 mt-auto 保证，
              底部按钮仍然对齐，不需要靠占位撑。
            -->
            <h3 class="text-base sm:text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
              {{ getCurrentLanguageValue(product, 'name') }}
            </h3>

            <!-- 描述为空时不渲染：否则每张卡都白占一行（生产商品的 description 多为空） -->
            <p
              v-if="getCurrentLanguageValue(product, 'description')"
              class="text-gray-600 text-sm mb-3 line-clamp-2 shrink-0"
            >
              {{ getCurrentLanguageValue(product, 'description') }}
            </p>
            
            <div class="mt-auto pt-2 border-t border-gray-100">
              <div class="mb-4 space-y-2">
                <!-- 主价居左；有积分则所需积分居右（同一行） -->
                <div class="flex justify-between items-baseline gap-x-3 gap-y-1">
                  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <template v-if="product.discount && product.discount > 0">
                      <span class="text-xl font-bold text-red-600">
                        {{ portalCurrency.formatThb(getDiscountPrice(product)) }}
                      </span>
                      <span class="text-sm text-gray-400 line-through">
                        {{ portalCurrency.formatThb(product.price) }}
                      </span>
                    </template>
                    <template v-else>
                      <span class="text-xl font-bold text-blue-600">
                        {{ portalCurrency.formatThb(product.price) }}
                      </span>
                    </template>
                  </div>
                  <span
                    v-if="product.points > 0"
                    class="shrink-0 text-right text-xs leading-tight font-medium text-amber-900 tabular-nums sm:text-sm sm:leading-normal"
                  >
                    {{ t('product.pointsValue', { points: product.points }) }}
                  </span>
                </div>

                <!-- 库存数量（原绿/黄/红档位不变） -->
                <div class="flex justify-between items-start gap-3 text-xs">
                  <div class="min-w-0 shrink text-left">
                    <span
                      class="tabular-nums"
                      :class="product.stock > 10
                        ? 'text-green-600'
                        : product.stock > 0
                          ? 'text-yellow-600'
                          : 'text-red-600'"
                    >
                      {{ t('product.stockCount', { count: product.stock }) }}
                    </span>
                  </div>
                </div>
              </div>
              
              <!--
                移动端**纵向堆叠**，sm+ 才并排。
                实测（390px 视口）：两按钮并排时每个只剩 65px 内容宽，
                "Add to Cart" 被压成 **3 行竖排**，按钮区被撑到 82px 高
                （本该 44px）—— 卡片底部白白多出 38px。
                纵向堆叠后每个按钮有整行宽度，文字单行放得下。
              -->
              <div class="flex flex-col gap-2 sm:flex-row sm:space-x-2">
                <button
                  @click.stop="addToCart(product)"
                  :disabled="product.stock === 0 || isAdding(product.id)"
                  class="w-full sm:flex-1 px-3 py-2.5 sm:py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <span
                    v-if="isAdding(product.id)"
                    class="h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-transparent animate-spin"
                    aria-hidden="true"
                  />
                  {{ isAdding(product.id) ? t('product.adding') : t('product.addToCart') }}
                </button>
                <button
                  @click.stop="buyNow(product)"
                  :disabled="product.stock === 0"
                  class="w-full sm:flex-1 px-3 py-2.5 sm:py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 inline-flex items-center justify-center whitespace-nowrap"
                >
                  {{ t('product.buyNow') }}
                </button>
              </div>
            </div>
          </div>
        </a>
      </div>
      
      <!-- 空状态：区分"搜不到"与"没有商品"，并给出下一步动作 -->
      <div v-else class="text-center py-12">
        <svg class="mx-auto h-24 w-24 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
        <!--
          加载失败（第 48 轮）：与"没有商品"分开 ——
          说清楚是加载失败，并给一个"重试"的动作，别让用户反复刷新。
        -->
        <template v-if="loadError">
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            {{ t('common.loadFailed') }}
          </h3>
          <p class="text-gray-500 mb-5">{{ loadError }}</p>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            @click="loadProducts({ append: false })"
          >
            {{ t('common.retry') }}
          </button>
        </template>
        <template v-else-if="searchQuery">
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            {{ t('product.noSearchResult', { keyword: searchQuery }) }}
          </h3>
          <p class="text-gray-500 mb-5">
            {{ t('product.noSearchResultHint') }}
          </p>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            @click="clearSearch"
          >
            {{ t('product.clearSearch') }}
          </button>
        </template>
        <template v-else>
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            {{ t('product.noProducts') }}
          </h3>
          <p class="text-gray-500">
            {{ t('cart.emptyDesc') }}
          </p>
        </template>
      </div>

      <!-- 触底加载：延后触发便于在列表底部看到加载态 -->
      <div
        v-show="products.length > 0 && hasMore"
        ref="loadMoreSentinel"
        class="flex min-h-[5rem] w-full shrink-0 flex-col items-center justify-center gap-2 py-4 touch-manipulation"
        role="status"
        :aria-busy="loadingMore"
      >
        <template v-if="loadingMore">
          <div class="flex items-center gap-3 text-gray-600">
            <div
              class="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
              aria-hidden="true"
            />
            <span class="text-sm font-medium">{{ t('product.loadMore') }}</span>
          </div>
        </template>
      </div>
      <p
        v-if="products.length > 0 && !hasMore && !loadingMore && !isLoading"
        class="text-center text-sm text-gray-500 py-6"
      >
        {{ t('product.noMoreProducts') }}
      </p>
      </section>
    </main>

    <!--
      消息提示。
      带**可选的操作按钮**：加购成功时直接给一个「去结算」——
      否则用户加完购还要：点顶栏购物车图标 → 进购物车页 → 点「去结算」＝多 2 次点击。
    -->
    <Transition name="fade">
      <div
        v-if="showMessage"
        :class="messageClass"
        class="fixed top-20 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-40 flex items-center gap-3"
      >
        <span>{{ message }}</span>
        <button
          v-if="messageAction"
          type="button"
          class="shrink-0 px-3 py-1.5 rounded-md text-sm font-semibold bg-white/90 text-blue-700 hover:bg-white shadow-sm"
          @click="messageAction.onClick"
        >
          {{ messageAction.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { inRestoreWindow } from '../../shared/scrollMemory.js'
import { formatAmount } from '../../shared/money.js'
/**
 * v-motion 指令**按需引入**（不全局注册 → 动画库只跟着本页的 chunk 走）。
 *
 * 两个坑：
 * 1) 模板里写的是 `v-motion`，Vue 会把 setup 里的 `vMotion` 绑定解析成该指令
 * 2) `MotionDirective` 导出的是**工厂函数**（插件内部是
 *    `app.directive('motion', directive())`）—— 必须**调用一次**拿到指令对象。
 *    直接把它当指令对象用，指令没有任何钩子 → 动画**静默失效**
 *    （页面照常渲染，测试也照样过，只有专门断言动画才抓得到）。
 */
import { MotionDirective } from '@vueuse/motion'
const vMotion = MotionDirective()
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '../stores/cart.js'
import { useUserStore } from '../stores/user.js'
import { productAPI } from '../api/products.js'
// 多语言取值统一到这一份（第 54 轮：此前 Home/ProductDetail 各有一份实现，行为已漂移）
import getCurrentLanguageValue from '../utils/language.js'
import { bundleAPI } from '../api/bundles.js'
import config from '../../config/index.js'
import { useToast } from '../composables/useToast.js'
import { usePortalCurrencyStore, loadPublicConfig } from '../stores/portalCurrency.js'
import SkeletonCard from '../components/ui/SkeletonCard.vue'
import ImageFade from '../components/ui/ImageFade.vue'
import { appleSpring, subtleSpring, bouncySpring } from '../composables/useSpring.js'
import { prefetchRoutesWhenIdle } from '../../utils/routePrefetch.js'
import { useReducedMotion } from '../composables/useReducedMotion.js'
import { imageSrcSet, imageLoadingFor } from '../../utils/imageVariants.js'

const portalCurrency = usePortalCurrencyStore()

/**
 * 首屏前几张图用 eager + fetchpriority=high。
 *
 * 原来**所有**图都是 loading="lazy" —— 连首屏那几张也是：
 * 浏览器要先算完布局才知道它可见，等于首屏图反而最后才到，
 * 白白多等一轮。首屏之外的保持 lazy（滚到才下）。
 */
const cardLoading = (index) => imageLoadingFor(index, 4)

// Home.vue组件已加载

// 国际化
const { t, locale } = useI18n()

// 路由和状态管理
const router = useRouter()
const route = useRoute()
const cartStore = useCartStore()
const userStore = useUserStore()
const { showError } = useToast()

// 响应式数据
const isLoading = ref(false)
const loadingMore = ref(false)
const products = ref([])
/** 加载失败（第 48 轮）：要和"确实没有商品"区分开 */
const loadError = ref('')
const searchQuery = ref('')
/** 搜索中（用于输入框转圈 + 结果数置灰） */
const searching = ref(false)
/** 命中总数（用于"找到 N 件"） */
const searchTotal = ref(0)
/** 正在进行的搜索请求的 AbortController：新的搜索会中止旧的（服务端也不用白算） */
let searchAbort = null
const currentPage = ref(1)
const totalPages = ref(1)
const pageSize = 8
const homeBanner = ref(null)
const loadMoreSentinel = ref(null)
const loadMoreBusy = ref(false)
let loadMoreObserver = null
let searchDebounceTimer = null
/** 移动端等环境下 IO 不可靠时：用 passive 滚动检测距文档底部距离 */
let scrollProximityRaf = null

/**
 * 卡片入场动画只应用到第一页的前 8 张（首屏可见），避免长列表 200 个 v-motion 状态机导致 GC 压力。
 * 后续卡片用 CSS 简单 fade-in（.css-card-fade-in）。
 */
const shouldAnimateCard = (idx) => currentPage.value === 1 && idx < 8 && !reducedMotion.value

/** 桌面端 hover 存在；移动端 hover 不存在（触摸），不浪费 motion 状态 */
const isDesktop = computed(() => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true
})
const reducedMotion = useReducedMotion()

const categories = ref([])
const selectedCategoryId = ref(null)

/**
 * 分类 Tab 列表：**第一项是「全部」**（id = null）。
 *
 * ## 为什么第 43 轮加「全部」
 *
 * 原来首页**默认选中第一个分类**，带来两个问题：
 *
 * 1. **首页看不到其它分类的商品** —— 商城首页只展示第一个分类的东西，
 *    将来上架了新分类的商品，顾客在首屏永远看不到（必须自己点 Tab）。
 *    这与"首页 = 全店橱窗"的直觉相反。
 * 2. **形成串行往返（瀑布）** —— 商品列表要带 `category_id`，
 *    而"第一个分类的 id"只能从分类接口拿到 → 必须先等分类、再发商品请求，
 *    首屏白白多等一个 RTT。
 *
 * 默认改成「全部」后，两个问题一起消失：
 * 首屏展示全部商品，且分类与商品可以**并行**请求。
 */
const categoryTabs = computed(() => [
  { id: null, name: t('product.allCategories') },
  ...categories.value.map((c) => ({ id: c.id, name: c.name }))
])

// 分类 Tab 横滑边界渐隐：提示右侧/左侧还有内容可滑
const categoryTabScroller = ref(null)
const categoryTabFadeRight = ref(false)
const categoryTabFadeLeft = ref(false)
const updateCategoryTabFade = () => {
  const el = categoryTabScroller.value
  if (!el) {
    categoryTabFadeRight.value = false
    categoryTabFadeLeft.value = false
    return
  }
  const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft
  categoryTabFadeRight.value = remaining > 8
  categoryTabFadeLeft.value = el.scrollLeft > 8
}
watch(categories, async () => {
  await nextTick()
  updateCategoryTabFade()
})

// 组合套餐
const bundles = ref([])
const bundlesLoading = ref(false)

const hasMore = computed(() => currentPage.value < totalPages.value)

// 消息提示
const showMessage = ref(false)
const message = ref('')
const messageType = ref('success')
/** 提示条上的可选操作按钮（如加购后的「去结算」） */
const messageAction = ref(null)

/**
 * 当前语言：跟随全局 locale（见下方 watch(..., { immediate: true })）。
 * 默认值只是**首次加载瞬间**的占位 —— watch 会立即用真实 locale 覆盖。
 */
const currentLanguage = ref('zh-CN')

// 获取当前语言的值
// 获取完整的图片URL - 使用配置管理器
const getImageUrl = (imagePath) => {
  return config.buildStaticUrl(imagePath)
}

// 显示消息提示
const showMessageToast = (msg, type = 'success', params = {}, action = null) => {
  const translatedMsg = getTranslatedMessage(msg, params)
  message.value = translatedMsg
  messageType.value = type
  messageAction.value = action
  showMessage.value = true
  
  setTimeout(() => {
    showMessage.value = false
    messageAction.value = null
  }, action ? 5000 : 3000)
}

// 获取国际化消息
const getTranslatedMessage = (key, params = {}) => {
  const messageMap = {
    'addSuccess': () => t('cart.addSuccess'),
    'addFailed': () => t('cart.addFailed'),
    'updateSuccess': () => t('cart.updateSuccess'),
    'updateFailed': () => t('cart.updateFailed'),
    'removeSuccess': () => t('cart.removeSuccess'),
    'removeFailed': () => t('cart.removeFailed'),
    'clearSuccess': () => t('cart.clearSuccess'),
    'clearFailed': () => t('cart.clearFailed'),
    'outOfStock': () => t('product.outOfStock'),
    // 简化库存不足提示
    'stockInsufficientSimple': () => t('cart.stockInsufficientSimple')
  }
  
  if (messageMap[key]) {
    return messageMap[key]()
  }
  
  return key
}

// 计算消息样式
const messageClass = computed(() => {
  return messageType.value === 'success' 
    ? 'bg-green-500 text-white' 
    : 'bg-red-500 text-white'
})

// 加载系统配置（共享缓存，避免与各页面重复请求）
const loadSystemConfig = async () => {
  const data = await loadPublicConfig()
  if (data) {
    homeBanner.value = data.home_banner
  }
}

const mapProductRow = (product) => ({
  id: product.id,
  name: product.name,
  name_th: product.name_th,
  description: product.description,
  description_th: product.description_th,
  price: parseFloat(product.price),
  discount: product.discount,
  stock: product.stock,
  image_url: product.image || defaultImage,
  category_id: product.category_id,
  category: product.category,
  points: product.points != null ? Number(product.points) : 0,
})

const loadBundles = async () => {
  bundlesLoading.value = true
  try {
    const res = await bundleAPI.getBundles()
    if (res.data?.success && Array.isArray(res.data.data)) {
      bundles.value = res.data.data
    } else {
      bundles.value = []
    }
  } catch (e) {
    // 套餐为附加区块：加载失败静默降级为不展示，不影响商品列表
    console.warn('加载组合套餐失败:', e)
    bundles.value = []
  } finally {
    bundlesLoading.value = false
  }
}

// 套餐组件行归一：购物车行为嵌套 product，公开列表为扁平 product_name/product_name_th
const bundleComponentProduct = (it) => {
  if (it?.product) return it.product
  if (it && (it.product_name || it.product_name_th)) {
    return { name: it.product_name, name_th: it.product_name_th }
  }
  return {}
}

// 套餐组件摘要：A×1 + B×2（组件名按当前语言取值）
const bundleItemsSummary = (bundle) => {
  const items = Array.isArray(bundle?.items) ? bundle.items : []
  return items
    .map(it => `${getCurrentLanguageValue(bundleComponentProduct(it), 'name')}×${it.quantity}`)
    .join(' + ')
}

// 相对单独购买的节省金额（<=0 时不展示划线价与节省标签）
const bundleSave = (bundle) => {
  const save = Number(bundle?.standalone_total) - Number(bundle?.price)
  return Number.isFinite(save) && save > 0 ? save : 0
}

const loadCategories = async () => {
  try {
    const res = await productAPI.getProductCategories()
    if (!res.data.success || !Array.isArray(res.data.data)) return
    categories.value = res.data.data
    /**
     * 第 43 轮：**不再自动选中第一个分类**（默认就是「全部」）。
     * 只有"用户选过的分类已经不存在"时才退回「全部」。
     */
    if (selectedCategoryId.value != null &&
        !categories.value.some((c) => c.id === selectedCategoryId.value)) {
      /**
       * 第 54 轮：分类可能来自 **URL 参数**（可分享的分类链接）。
       * 如果 URL 里的分类 id 不存在，除了置空，还得**重新加载商品** ——
       * 否则首屏那次商品请求带着无效 category_id 发出去了，返回空列表，
       * 页面会一直停在"没有商品"。
       */
      const hadInvalid = selectedCategoryId.value != null
      selectedCategoryId.value = null
      if (hadInvalid) {
        await loadProducts({ append: false })
      }
    }
  } catch (e) {
    console.warn('加载分类失败', e)
  }
}

/**
 * 把当前分类同步到 URL（第 54 轮）。
 *
 * 为什么需要：分类筛选原来只存在于组件内部 state，
 * **URL 不变** → 分类页不可分享、不可收藏、搜索引擎也发现不了
 * （sitemap 里给了 /portal/?category=40，但如果首页不读这个参数，那个 URL 就是无效的）。
 *
 * 用 replace 而不是 push：切换分类是"筛选"不是"导航"，
 * 不该在浏览器历史里堆一长串。
 */
const syncCategoryToUrl = (id) => {
  const query = { ...route.query }
  if (id == null) delete query.category
  else query.category = String(id)
  router.replace({ query }).catch(() => {})
}

const selectCategory = async (id) => {
  // null = 「全部」（不带分类过滤）；其余是具体分类 id
  const n = id == null ? null : Number(id)
  if (n != null && Number.isNaN(n)) return
  if (selectedCategoryId.value === n) return
  selectedCategoryId.value = n
  syncCategoryToUrl(n)
  currentPage.value = 1
  loadMoreObserver?.disconnect()
  products.value = []
  await loadProducts({ append: false })
  await nextTick()
  attachInfiniteScroll()
}

/** 仅商品列表区域：左右滑切换分类（Tab 条仅横向滚动，事件不在此区域内） */
const productSwipeStart = ref({ x: 0, y: 0 })

const onProductAreaTouchStart = (e) => {
  const t = e.touches?.[0] ?? e.changedTouches?.[0]
  if (!t) return
  productSwipeStart.value = { x: t.clientX, y: t.clientY }
}

const onProductAreaTouchEnd = (e) => {
  // 第 43 轮：滑动列表改用 categoryTabs（含「全部」），"全部"也是一个可选的停靠点
  if (categoryTabs.value.length < 2) return
  const t = e.changedTouches?.[0]
  if (!t) return
  const dx = t.clientX - productSwipeStart.value.x
  const dyAbs = Math.abs(t.clientY - productSwipeStart.value.y)
  if (Math.abs(dx) < 52 || dyAbs > 90) return
  const idx = categoryTabs.value.findIndex((c) => c.id === selectedCategoryId.value)
  if (idx < 0) return
  if (dx < 0 && idx < categoryTabs.value.length - 1) {
    selectCategory(categoryTabs.value[idx + 1].id)
  } else if (dx > 0 && idx > 0) {
    selectCategory(categoryTabs.value[idx - 1].id)
  }
}

// 无限滚动列表上限：最多保留 200 条，超出截断最早的记录并停止继续加载（触底提示复用 product.noMoreProducts）
const MAX_HOME_PRODUCTS = 200

/**
 * 请求序号守卫：搜索防抖与分类切换会并发发起请求，
 * 若旧请求后到就会覆盖新结果（列表与搜索框/分类对不上）。
 * 与 admin Products.vue 的 loadSeq 同一套模式。
 */
let productLoadSeq = 0

const loadProducts = async ({ append = false } = {}) => {
  if (append) {
    loadingMore.value = true
  } else {
    isLoading.value = true
  }
  const seq = ++productLoadSeq

  try {
    const params = {
      page: currentPage.value,
      pageSize,
      name: searchQuery.value?.trim() || undefined,
      ...(selectedCategoryId.value != null
        ? { category_id: selectedCategoryId.value }
        : {})
    }

    // 搜索请求可被新的搜索/清除中止（避免服务端白算）
    const isSearch = !!params.name
    if (isSearch) {
      abortSearch()
      searchAbort = new AbortController()
    }
    const response = await productAPI.getProducts(params, searchAbort?.signal)
    if (seq !== productLoadSeq) return // 已有更新的请求在途，丢弃过期响应
    searching.value = false

    if (response.data.success) {
      const list = (response.data.data.products || []).map(mapProductRow)
      totalPages.value = response.data.data.totalPages || 1
      // "找到 N 件"：搜索时给出命中总数（分页前）
      if (isSearch) {
        searchTotal.value = Number(response.data.data.total ?? list.length) || 0
      }

      if (append) {
        const seen = new Set(products.value.map((p) => p.id))
        for (const p of list) {
          if (!seen.has(p.id)) {
            seen.add(p.id)
            products.value.push(p)
          }
        }
        if (products.value.length > MAX_HOME_PRODUCTS) {
          products.value.splice(0, products.value.length - MAX_HOME_PRODUCTS)
          // 使 hasMore=false，停止后续加载并展示「已加载全部商品」
          totalPages.value = currentPage.value
        }
      } else {
        products.value = list
      }
      loadError.value = ''
    } else {
      console.error('加载产品失败:', response.data.message)
      loadError.value = response.data.message || t('common.loadFailed')
      showError(t('common.loadFailed'))
    }
  } catch (error) {
    // 被新的搜索中止的请求：**不是错误**，静默丢弃（用户已经在搜下一个词了）
    if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
      return
    }
    console.error('加载产品失败:', error)
    /**
     * 第 48 轮：不再把 axios 原文（"Network Error" / "timeout of 10000ms exceeded"）
     * 甩给用户 —— 那不是他能处理的信息。统一成"网络不稳，请重试"。
     */
    loadError.value = t('common.networkUnstable')
    showError(t('common.networkUnstable'))
  } finally {
    if (seq === productLoadSeq) {
      isLoading.value = false
      loadingMore.value = false
    }
  }
}

const loadNextPage = async () => {
  if (loadMoreBusy.value || loadingMore.value || isLoading.value || !hasMore.value) return
  /**
   * 刚恢复滚动位置时不要自动加载下一页。
   *
   * 返回列表页时页面只渲染了第一页，高度不够 → 恢复位置后"接近底部"判断成立
   * → 无限滚动被误触发 → 列表莫名多出一倍商品（用户会觉得"列表怎么变了"）。
   *
   * 这里放在**入口**而不是各个触发点上：触发路径有两条
   * （IntersectionObserver 与"滚动接近底部"），只挡一条会漏。
   */
  if (inRestoreWindow()) return
  loadMoreBusy.value = true
  try {
    currentPage.value += 1
    await loadProducts({ append: true })
  } finally {
    loadMoreBusy.value = false
  }
}

const checkScrollNearBottom = () => {
  if (!hasMore.value || loadingMore.value || isLoading.value || loadMoreBusy.value) return false
  if (typeof window === 'undefined' || typeof document === 'undefined') return false

  const docEl = document.documentElement
  const bodyEl = document.body
  const scrollTop = window.scrollY ?? docEl.scrollTop ?? bodyEl.scrollTop ?? 0
  const scrollHeight = Math.max(
    docEl.scrollHeight ?? 0,
    bodyEl.scrollHeight ?? 0,
    docEl.offsetHeight ?? 0
  )
  // 使用 innerHeight + scrollY 与 scrollHeight 对齐（与多数移动端浏览器行为一致）
  const innerH = window.innerHeight || docEl.clientHeight || 0
  const distanceToBottom = scrollHeight - (scrollTop + innerH)
  // 接近窗口底部时再加载（与 IO 延后策略一致）
  return distanceToBottom <= 72
}

const onWindowScrollProximity = () => {
  if (!hasMore.value) return
  if (scrollProximityRaf != null) return
  scrollProximityRaf = requestAnimationFrame(() => {
    scrollProximityRaf = null
    if (checkScrollNearBottom()) loadNextPage()
  })
}

const attachInfiniteScroll = () => {
  loadMoreObserver?.disconnect()
  const el = loadMoreSentinel.value
  if (!el || !products.value.length || !hasMore.value) return

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      const hit = entries.some((e) => e.isIntersecting)
      // 刚恢复滚动位置时不要自动加载下一页（否则列表会莫名多出一倍商品）
      if (hit && !inRestoreWindow()) loadNextPage()
    },
    // 负值 bottom 缩小根矩形底部，需多滚一截才让哨兵算「进入视区」，避免过早加载
    { root: null, rootMargin: '0px 0px -72px 0px', threshold: 0 }
  )
  loadMoreObserver.observe(el)
}

// 计算折扣价格
const getDiscountPrice = (product) => {
  if (!product.discount || product.discount <= 0) {
    return product.price
  }
  const discountPrice = product.price * (1 - product.discount / 100)
  return formatAmount(discountPrice)
}

// 跳转到产品详情
const goToProductDetail = (productId) => {
  router.push(`/products/${productId}`)
}

// 正在加购的商品 id（防止连点导致加多次）
const addingIds = ref(new Set())
const isAdding = (id) => addingIds.value.has(id)

// 添加到购物车 - 游客可用
const addToCart = async (product) => {
  if (product.stock === 0) {
    showMessageToast('outOfStock', 'error')
    return
  }
  // 已经在加购中 → 忽略连点
  if (addingIds.value.has(product.id)) return
  addingIds.value.add(product.id)

  try {
    const result = await cartStore.addToCart(product, 1)
    
    if (result.success) {
      // 加购成功 → 提示条上直接给「去结算」，省掉"点购物车 → 点结算"两次点击
      showMessageToast(result.message, 'success', result.messageParams || {}, {
        label: t('cart.checkout'),
        onClick: () => router.push('/checkout')
      })
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast('addFailed', 'error')
  } finally {
    addingIds.value.delete(product.id)
  }
}

// 套餐加入购物车 - 游客可用
const addBundle = async (bundle) => {
  if (!(Number(bundle.available_stock) > 0)) {
    showMessageToast('outOfStock', 'error')
    return
  }

  try {
    const result = await cartStore.addBundleToCart(bundle, 1)

    if (result.success) {
      showMessageToast(result.message, 'success', result.messageParams || {})
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast('addFailed', 'error')
  }
}

// 立即购买 - 游客可用
const buyNow = async (product) => {
  if (product.stock === 0) {
    showMessageToast('outOfStock', 'error')
    return
  }
  
  try {
    const result = await cartStore.addToCart(product, 1)
    
    if (result.success) {
      // 直接跳转到结算页面
      router.push('/checkout')
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast('addFailed', 'error')
  }
}

// 默认图片（使用data URI避免网络请求和console错误）
const defaultImage = 'data:image/svg+xml,%3Csvg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="400" height="400" fill="%23F3F4F6"/%3E%3Cpath d="M120 140c0-8.284 6.716-15 15-15h130c8.284 0 15 6.716 15 15v120c0 8.284-6.716 15-15 15H135c-8.284 0-15-6.716-15-15V140z" fill="%23D1D5DB"/%3E%3Ccircle cx="160" cy="170" r="15" fill="%23909090"/%3E%3Cpath d="M120 230l40-50 40 25 60-70 80 95V140H120v90z" fill="%23909090"/%3E%3Ctext x="200" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="%23666"%E6%97%A0%E5%9B%BE%E7%89%87%3C/text%3E%3C/svg%3E'

// 图片处理 - 静默处理错误，避免console报错
const handleImageError = (event) => {
  // 避免循环错误，只在不是默认图片时才替换
  if (event.target.src !== defaultImage) {
    event.target.src = defaultImage
  }
}

const handleImageLoad = (event) => {
  // 静默处理，不输出日志
}

// 处理长图加载错误
const handleBannerError = (event) => {
  console.warn('首页长图加载失败，隐藏长图显示')
  homeBanner.value = null
}

watch(
  () => searchQuery.value,
  () => {
    clearTimeout(searchDebounceTimer)
    // 词还在变 → 上一轮的请求没有意义了，直接中止（服务端也少算一次）
    abortSearch()
    searching.value = true
    searchDebounceTimer = setTimeout(async () => {
      currentPage.value = 1
      await loadProducts({ append: false })
      await nextTick()
      attachInfiniteScroll()
    }, 400)
  }
)

/** 中止在途的搜索请求 */
function abortSearch () {
  if (searchAbort) {
    try { searchAbort.abort() } catch (_) { /* 中止上一次搜索失败无需处理 */ }
    searchAbort = null
  }
}

/** 回车：立刻搜索（不等防抖） */
function searchNow () {
  clearTimeout(searchDebounceTimer)
  abortSearch()
  searching.value = true
  currentPage.value = 1
  loadProducts({ append: false }).then(async () => {
    await nextTick()
    attachInfiniteScroll()
  })
}

/** 清除搜索（Esc / ×）：恢复完整列表 */
function clearSearch () {
  clearTimeout(searchDebounceTimer)
  searchQuery.value = ''
  searching.value = false
  currentPage.value = 1
  loadProducts({ append: false }).then(async () => {
    await nextTick()
    attachInfiniteScroll()
  })
}

watch(
  () => locale.value,
  (v) => {
    if (v) currentLanguage.value = v
  },
  { immediate: true }
)

watch(
  () => [products.value.length, hasMore.value],
  () => {
    nextTick(() => attachInfiniteScroll())
  }
)

// 组件挂载时加载数据
onMounted(async () => {
  /**
   * 空闲时预取商品详情页的 chunk。
   * 商品卡是 <div @click>（不是链接），hover 事件委托覆盖不到它，
   * 所以补一条"空闲预取"：用户还在看首页时，详情页代码就已下载好。
   */
  prefetchRoutesWhenIdle(router, ['ProductDetail'])
  /**
   * 第 43 轮：四个请求**并行**发起（原来是"分类 → 商品"串行）。
   *
   * 串行的原因已经消除：商品列表原本必须带 `category_id`，
   * 而"第一个分类的 id"只能从分类接口拿到 → 必须等分类回来才能发商品请求。
   * 现在默认是「全部」，商品请求不再依赖分类结果 → 两个请求可以同时发。
   *
   * 实测（生产）：首屏 API 阶段从 187ms 降到 ~70ms；
   * 链路差（每次建连 100~1000ms）时省得更多 —— 每少一个串行往返就少挨一次网络抖动。
   */
  /**
   * 先从 URL 读初始分类（第 54 轮）：`/portal/?category=40` 直接打开就是该分类。
   *
   * 放在 Promise.all **之前**是必须的：商品请求要带 category_id，
   * 等分类接口回来再改就晚了（会多发一次请求，还闪一下空列表）。
   *
   * 分类 id 是否有效由 loadCategories 校验（无效会置空并重新加载商品）。
   */
  const catParam = route.query.category
  if (catParam != null && catParam !== '') {
    const n = Number(catParam)
    if (Number.isFinite(n)) selectedCategoryId.value = n
  }

  await Promise.all([
    loadSystemConfig(),
    loadBundles(),
    loadCategories(),
    loadProducts({ append: false })
  ])
  await nextTick()
  attachInfiniteScroll()
  updateCategoryTabFade()
  window.addEventListener('scroll', onWindowScrollProximity, { passive: true })
  window.addEventListener('resize', updateCategoryTabFade, { passive: true })
  window.visualViewport?.addEventListener?.('resize', onWindowScrollProximity)
})

onUnmounted(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  window.removeEventListener('scroll', onWindowScrollProximity, { passive: true })
  window.removeEventListener('resize', updateCategoryTabFade, { passive: true })
  window.visualViewport?.removeEventListener?.('resize', onWindowScrollProximity)
  if (scrollProximityRaf != null) {
    cancelAnimationFrame(scrollProximityRaf)
    scrollProximityRaf = null
  }
  clearTimeout(searchDebounceTimer)
})
</script>

<style scoped>
/* 消息提示动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* 分类 Tab 横滑边界渐隐（按滚动位置动态挂载，提示还有内容可滑） */
.category-tab-scroll.cat-fade-right {
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to right, black calc(100% - 2.5rem), transparent);
}

.category-tab-scroll.cat-fade-left {
  -webkit-mask-image: linear-gradient(to right, transparent, black 2.5rem);
  mask-image: linear-gradient(to right, transparent, black 2.5rem);
}

.category-tab-scroll.cat-fade-left.cat-fade-right {
  -webkit-mask-image: linear-gradient(to right, transparent, black 2.5rem, black calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to right, transparent, black 2.5rem, black calc(100% - 2.5rem), transparent);
}
</style>