import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['src/**/__tests__/**/*.integration.test.{js,jsx,ts,tsx}'],
  },
})
