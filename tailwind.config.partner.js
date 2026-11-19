/**
 * 合作方门户（批发端）专用 Tailwind 配置
 *
 * ## 为什么要单独一份
 *
 * 用户要求「批发商和客户的两端要有明显的样式风格区别」。
 * 原来的 tailwind.config.js 的 content 里**混着三个前端**
 * （portal / admin / partner），primary 色板硬编码为蓝色 #2563eb ——
 * 于是**客户门户与合作方门户长得几乎一样**，一眼分不出是零售还是批发。
 *
 * Tailwind v3.4 支持在 CSS 里用 `@config` 指定另一份配置，
 * 所以给 partner 单独一份即可：
 *
 *   src/portal/style.css     → 默认 tailwind.config.js（零售：蓝 / 圆润 / 亲和）
 *   src/partner/style.css    → @config tailwind.config.partner.js（批发：墨绿 / 方正 / 工具感）
 *   src/admin/*              —— 不引 Tailwind（用 Element Plus）
 *
 * ## 差异设计
 *
 * | 维度 | 客户门户（零售） | 合作方门户（批发） |
 * |---|---|---|
 * | 主色 | 蓝 #2563eb（亲和、促单） | **墨绿 #0f766e**（工具、专业、克制） |
 * | 圆角 | sm 6 / md 8 / lg 12 / xl 16 | **sm 2 / md 4 / lg 6 / xl 8**（方正、紧凑） |
 * | 字体 | Inter 为主 | **Inter + 略小字号**（一屏看更多行） |
 * | 底色 | #f9fafb 冷灰 | **#f1f5f4 淡青灰**（与主色同族） |
 * | 顶栏 | 白色 + 细边 | **深墨绿 #0f3d38 + 白字**（与零售一眼分开） |
 *
 * 组件里的 `primary-600` / `rounded-lg` 等类名**一个字都不用改** ——
 * 换配置即换风格。
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/partner/**/*.{js,ts,jsx,tsx,vue}',
    './src/partner/index.html'
  ],
  theme: {
    extend: {
      colors: {
        /**
         * 批发端主色：墨绿（teal）。
         * 与零售端的蓝在色相上差 ~150°，并排使用不会混淆。
         * 选 teal 而不是深灰：仍是有"品牌感"的色相，但饱和度低、不促销，
         * 符合 B2B 工具的调性。
         */
        primary: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e'
        },
        /** 中性色偏冷青，与主色同族（零售端用的是偏冷灰） */
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f4',
          200: '#e2e8e6',
          300: '#cbd5d2',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        thai: ['Noto Sans Thai', 'system-ui', 'sans-serif']
      },
      screens: {
        xs: '475px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px'
      },
      spacing: {
        18: '4.5rem',
        88: '22rem',
        128: '32rem'
      },
      /**
       * 圆角更方正 —— 批发端要的是"表格/工具"的硬朗感，
       * 不是零售那种"卡片/亲和"的圆润感。
       */
      borderRadius: {
        none: '0px',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '12px',
        full: '9999px'
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'bounce-subtle': 'bounceSubtle 0.6s ease-in-out',
        'slide-up-soft': 'slideUpSoft 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'pop': 'pop 0.2s cubic-bezier(0.34, 1.4, 0.64, 1)',
        shimmer: 'shimmer 1.4s ease-in-out infinite'
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-soft': 'cubic-bezier(0.32, 0, 0.67, 0)',
        spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' }
        },
        slideUpSoft: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        pop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(0.96)' },
          '100%': { transform: 'scale(1)' }
        },
        shimmer: {
          '100%': { backgroundPosition: '-200% 0' }
        }
      },
      boxShadow: {
        soft: '0 2px 8px rgba(0, 0, 0, 0.06)',
        medium: '0 4px 16px rgba(0, 0, 0, 0.08)',
        strong: '0 8px 32px rgba(0, 0, 0, 0.12)'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ]
}
