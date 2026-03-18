/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf8f0',
          100: '#faecd6',
          500: '#e8a24a',
          600: '#d4882e',
          700: '#b36a1a',
        },
      },
    },
  },
  plugins: [],
};
