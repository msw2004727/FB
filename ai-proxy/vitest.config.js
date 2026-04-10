import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.js'],
        testTimeout: 10000,
        coverage: {
            provider: 'v8',
            include: [
                'services/**',
                'middleware/**',
                'routes/**',
                'prompts/**',
                'aiConfig.js'
            ]
        }
    }
});
