/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Cyberpunk color palette
      colors: {
        // Primary neons
        neon: {
          cyan: '#00ffff',
          magenta: '#ff00ff',
          purple: '#bf00ff',
          pink: '#ff0080',
          blue: '#0080ff',
          green: '#00ff80',
        },
        // Dark backgrounds
        cyber: {
          black: '#0a0a0f',
          darker: '#0d0d14',
          dark: '#12121a',
          medium: '#1a1a24',
          light: '#252530',
        },
        // Accent colors
        holo: {
          white: '#e0e0ff',
          silver: '#c0c0d0',
          gold: '#ffd700',
        },
      },
      // Cyberpunk fonts
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Orbitron', 'sans-serif'],
        cyber: ['Share Tech Mono', 'monospace'],
      },
      // Glow effects
      boxShadow: {
        'neon-cyan': '0 0 5px #00ffff, 0 0 10px #00ffff, 0 0 20px #00ffff',
        'neon-magenta': '0 0 5px #ff00ff, 0 0 10px #ff00ff, 0 0 20px #ff00ff',
        'neon-purple': '0 0 5px #bf00ff, 0 0 10px #bf00ff, 0 0 20px #bf00ff',
        'neon-pink': '0 0 5px #ff0080, 0 0 10px #ff0080, 0 0 20px #ff0080',
        'glow-sm': '0 0 10px currentColor',
        'glow-md': '0 0 20px currentColor',
        'glow-lg': '0 0 40px currentColor',
      },
      // Glitch animation
      animation: {
        'glitch': 'glitch 1s infinite',
        'glitch-fast': 'glitch 0.3s infinite',
        'scanline': 'scanline 8s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'flicker': 'flicker 0.15s infinite',
      },
      keyframes: {
        glitch: {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: 1, filter: 'brightness(1)' },
          '50%': { opacity: 0.8, filter: 'brightness(1.2)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        flicker: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.8 },
        },
      },
      // Background patterns
      backgroundImage: {
        'grid-pattern': `linear-gradient(rgba(0, 255, 255, 0.03) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(0, 255, 255, 0.03) 1px, transparent 1px)`,
        'hex-pattern': `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%2300ffff' fill-opacity='0.02' fill-rule='evenodd'/%3E%3C/svg%3E")`,
      },
    },
  },
  plugins: [],
};
