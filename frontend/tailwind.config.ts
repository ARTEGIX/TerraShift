import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        soil: { 50: "#faf6f1", 100: "#f0e6d8", 500: "#8b5e34", 700: "#5c3d22", 900: "#2e1f12" },
        leaf: { 50: "#f0f9f1", 100: "#dcf1de", 500: "#2f9e44", 600: "#2b8a3e", 700: "#237032", 900: "#14401d" },
        sky: { 500: "#1c7ed6" },
        // Apple-like neutral surfaces and text
        canvas: "#f5f5f7",
        ink: { DEFAULT: "#1d1d1f", 2: "#424245", 3: "#6e6e73", 4: "#86868b" },
        hairline: "#d2d2d7",
      },
      fontFamily: {
        // System font first (SF on Apple devices, Segoe on Windows), Inter as the web fallback.
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', "var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)",
        lift: "0 2px 6px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.10)",
      },
      keyframes: {
        orbit: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        "orbit-counter": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(-360deg)" } },
        grow: {
          "0%": { transform: "scaleY(0.2)", opacity: "0.3" },
          "60%": { transform: "scaleY(1)", opacity: "1" },
          "100%": { transform: "scaleY(1)", opacity: "1" },
        },
        drop: {
          "0%": { transform: "translateY(-6px)", opacity: "0" },
          "40%": { opacity: "1" },
          "100%": { transform: "translateY(14px)", opacity: "0" },
        },
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulse_soft: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
      },
      animation: {
        orbit: "orbit 6s linear infinite",
        "orbit-counter": "orbit-counter 6s linear infinite",
        grow: "grow 2.4s ease-out infinite",
        drop: "drop 1.4s ease-in infinite",
        "fade-up": "fade-up 0.35s ease-out both",
        "pulse-soft": "pulse_soft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
