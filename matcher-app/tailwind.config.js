/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Aptos", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)"
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)"
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)"
        },
        muted: {
          DEFAULT: "var(--muted-foreground)",
          foreground: "var(--muted-foreground)"
        },
        mutedSurface: "var(--muted)",
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)"
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)"
        },
        success: "var(--success)",
        warning: "var(--warning)",
        ink: "var(--foreground)",
        line: "var(--border)",
        paper: "var(--background)",
        panel: "var(--card)",
        danger: "var(--destructive)",
        warn: "var(--warning)"
      }
    }
  },
  plugins: []
};
