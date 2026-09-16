/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

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
        display: ['Geist', 'sans-serif'],
        heading: ['Geist', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Geist', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        background: c('--background'),
        foreground: c('--foreground'),
        card: { DEFAULT: c('--card'), foreground: c('--card-foreground') },
        popover: { DEFAULT: c('--popover'), foreground: c('--popover-foreground') },
        primary: { DEFAULT: c('--primary'), foreground: c('--primary-foreground') },
        secondary: { DEFAULT: c('--secondary'), foreground: c('--secondary-foreground') },
        muted: { DEFAULT: c('--muted'), foreground: c('--muted-foreground') },
        accent: { DEFAULT: c('--accent'), foreground: c('--accent-foreground') },
        destructive: { DEFAULT: c('--destructive'), foreground: c('--destructive-foreground') },
        border: c('--border'),
        input: c('--input'),
        ring: c('--ring'),
        surface: c('--surface'),
        'surface-lowest': c('--surface-lowest'),
        'surface-low': c('--surface-low'),
        'surface-mid': c('--surface-mid'),
        'surface-high': c('--surface-high'),
        'surface-highest': c('--surface-highest'),
        'surface-bright': c('--surface-bright'),
        'on-surface': c('--on-surface'),
        'on-surface-variant': c('--on-surface-variant'),
        outline: c('--outline'),
        'outline-variant': c('--outline-variant'),
        brand: c('--brand'),
        'brand-container': c('--brand-container'),
        'on-brand': c('--on-brand'),
        cyan: c('--cyan'),
        'cyan-container': c('--cyan-container'),
        orange: c('--orange'),
        danger: c('--danger'),
        chart: {
          '1': c('--chart1'),
          '2': c('--chart2'),
          '3': c('--chart3'),
          '4': c('--chart4'),
          '5': c('--chart5')
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
