/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './pages/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        farm: {
          base:     '#060a06',
          surface:  '#0d160d',
          elevated: '#0a0f0a',
          border:   '#1a2e1a',
          green:    '#4ade80',
          'green-dark': '#16a34a',
          red:      '#f87171',
          amber:    '#fbbf24',
          blue:     '#60a5fa',
          purple:   '#a78bfa',
          text:     '#e8f5e2',
          muted:    '#9ca3af',
          dim:      '#6b7280',
          faint:    '#4b5563',
        },
      },
      fontFamily: {
        mono:  ['"DM Mono"', '"Courier New"', 'monospace'],
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
      },
      borderRadius: {
        farm: '10px',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.3s ease forwards',
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: 0, transform: 'translateY(12px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
