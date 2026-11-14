import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        soil: { 50: "#faf6f1", 100: "#f0e6d8", 500: "#8b5e34", 700: "#5c3d22", 900: "#2e1f12" },
        leaf: { 50: "#f0f9f1", 100: "#dcf1de", 500: "#2f9e44", 600: "#2b8a3e", 700: "#237032", 900: "#14401d" },
        sky: { 500: "#1c7ed6" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
