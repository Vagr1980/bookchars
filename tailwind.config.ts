import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        purple: {
          50:  '#EEEDFE',
          100: '#CECBF6',
          200: '#AFA9EC',
          400: '#7F77DD',
          500: '#6B62D4',
          600: '#534AB7',
          700: '#3C3489',
          800: '#3C3489',
          900: '#26215C',
          950: '#1a1640',
        },
      },
      borderRadius: {
        xl:  '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
