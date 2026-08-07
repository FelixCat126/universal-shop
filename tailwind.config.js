/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/portal/**/*.{js,ts,jsx,tsx,vue}",
    "./src/admin/**/*.{js,ts,jsx,tsx,vue}",
    "./src/partner/**/*.{js,ts,jsx,tsx,vue}",
    "./src/portal/index.html",
    "./src/admin/index.html",
    "./src/partner/index.html"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe', 
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554'
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
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
        'xs': '475px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px'
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem'
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'bounce-subtle': 'bounceSubtle 0.6s ease-in-out',
        /* 极简高级风：标准 easing */
        'slide-up-soft': 'slideUpSoft 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'pop': 'pop 0.2s cubic-bezier(0.34, 1.4, 0.64, 1)',
        'shimmer': 'shimmer 1.4s ease-in-out infinite'
      },
      transitionTimingFunction: {
        'standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-soft': 'cubic-bezier(0.32, 0, 0.67, 0)',
        'spring': 'cubic-bezier(0.34, 1.4, 0.64, 1)'
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
        /* 极简高级风专用 */
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
        'soft': '0 2px 8px rgba(0, 0, 0, 0.06)',
        'medium': '0 4px 16px rgba(0, 0, 0, 0.08)',
        'strong': '0 8px 32px rgba(0, 0, 0, 0.12)'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ]
}