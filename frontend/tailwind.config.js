/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.375rem',
        xl: '1rem'
      },
      fontFamily: {
        display: ['"Hanken Grotesk"', 'sans-serif'],
        heading: ['"Hanken Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Geist', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        background: '#051424',
        foreground: '#d4e4fa',
        card: { DEFAULT: '#0d1c2d', foreground: '#d4e4fa' },
        popover: { DEFAULT: '#122131', foreground: '#d4e4fa' },
        primary: { DEFAULT: '#b4c5ff', foreground: '#002a78' },
        secondary: { DEFAULT: '#1c2b3c', foreground: '#d4e4fa' },
        muted: { DEFAULT: '#122131', foreground: '#c3c6d7' },
        accent: { DEFAULT: '#1c2b3c', foreground: '#d4e4fa' },
        destructive: { DEFAULT: '#93000a', foreground: '#ffdad6' },
        border: '#273647',
        input: '#273647',
        ring: '#b4c5ff',
        surface: '#051424',
        'surface-lowest': '#010f1f',
        'surface-low': '#0d1c2d',
        'surface-mid': '#122131',
        'surface-high': '#1c2b3c',
        'surface-highest': '#273647',
        'surface-bright': '#2c3a4c',
        'on-surface': '#d4e4fa',
        'on-surface-variant': '#c3c6d7',
        outline: '#8d90a0',
        'outline-variant': '#434655',
        brand: '#b4c5ff',
        'brand-container': '#2563eb',
        'on-brand': '#002a78',
        cyan: '#7bd0ff',
        'cyan-container': '#00a6e0',
        orange: '#ffb596',
        danger: '#ffb4ab',
        chart: {
          '1': '#b4c5ff',
          '2': '#7bd0ff',
          '3': '#2563eb',
          '4': '#ffb596',
          '5': '#ffb4ab'
        }
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-up': 'fade-up 0.5s ease-out both',
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};
