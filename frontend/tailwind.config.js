/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "#0ea5e9", // Sky 500
        secondary: "#64748b", // Slate 500
        success: "#10b981", // Emerald 500
        error: "#ef4444", // Red 500
        warning: "#f59e0b", // Amber 500
        card: "#0f172a", // Slate 900
        'bg-main': '#020617', // Slate 950
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'sans-serif'],
        mono: ['var(--font-fira-code)', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

