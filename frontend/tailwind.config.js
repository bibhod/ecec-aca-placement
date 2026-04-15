/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1A2B5F', light: '#243580', dark: '#111d42' },
        cyan: { DEFAULT: '#00AEEF', light: '#33bef2', dark: '#0090c5' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
