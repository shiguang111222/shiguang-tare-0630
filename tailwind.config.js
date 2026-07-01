/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0E0D0B",
          soft: "#2A2823",
          mist: "#3A372F",
        },
        paper: {
          DEFAULT: "#EDE4D3",
          shade: "#DCCFB2",
          deep: "#C7B894",
        },
        cinnabar: {
          DEFAULT: "#C0392B",
          deep: "#962D22",
          light: "#D85546",
        },
        gold: {
          DEFAULT: "#C9A24B",
          soft: "#8A7434",
          pale: "#E4C97A",
        },
        jade: "#4A6B5A",
      },
      fontFamily: {
        brush: ['"Ma Shan Zheng"', "cursive"],
        sub: ['"ZCOOL XiaoWei"', "serif"],
        serifsc: ['"Noto Serif SC"', "serif"],
      },
      boxShadow: {
        seal: "0 2px 0 #962D22, inset 0 0 0 2px rgba(0,0,0,0.06)",
        scroll: "0 10px 40px -10px rgba(0,0,0,0.6), inset 0 0 60px rgba(120,80,30,0.08)",
      },
      keyframes: {
        inkfade: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        sealstamp: {
          "0%": { transform: "scale(1.4) rotate(-8deg)", opacity: "0" },
          "60%": { transform: "scale(0.94) rotate(-2deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(-3deg)", opacity: "1" },
        },
        shimmer: {
          "0%,100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        eliminate: {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "30%": { opacity: "0.9", transform: "scale(1.1)" },
          "100%": { opacity: "0", transform: "scale(1.4)" },
        },
        tickpulse: {
          "0%,100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.18)" },
        },
      },
      animation: {
        inkfade: "inkfade 0.5s ease-out both",
        sealstamp: "sealstamp 0.45s cubic-bezier(.2,.8,.2,1) both",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        eliminate: "eliminate 1.2s ease-out forwards",
        tickpulse: "tickpulse 0.4s ease-out",
      },
    },
  },
  plugins: [],
};
