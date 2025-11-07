import ms from 'ms'

export default class Util {

    async wait(ms: number): Promise<void> {
        // Safety check: prevent extremely long or negative waits
        const MAX_WAIT_MS = 3600000 // 1 hour max
        const safeMs = Math.min(Math.max(0, ms), MAX_WAIT_MS)
        
        if (ms !== safeMs) {
            console.warn(`[Utils] wait() clamped from ${ms}ms to ${safeMs}ms (max: ${MAX_WAIT_MS}ms)`)
        }
        
        return new Promise<void>((resolve) => {
            setTimeout(resolve, safeMs)
        })
    }

    async waitRandom(min_ms: number, max_ms: number, distribution: 'uniform' | 'normal' = 'uniform'): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, this.randomNumber(min_ms, max_ms, distribution))
        })
    }

    getFormattedDate(ms = Date.now()): string {
        const today = new Date(ms)
        const month = String(today.getMonth() + 1).padStart(2, '0')  // January is 0
        const day = String(today.getDate()).padStart(2, '0')
        const year = today.getFullYear()

        return `${month}/${day}/${year}`
    }

    shuffleArray<T>(array: T[]): T[] {
        return array.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value)
    }

    randomNumber(min: number, max: number, distribution: 'uniform' | 'normal' = 'uniform'): number {
        if (distribution === 'uniform') {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        // 正态分布实现 (Box-Muller变换)
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        num = num / 10.0 + 0.5; // 标准化到0-1范围
        if (num > 1 || num < 0) num = this.randomNumber(min, max, distribution); // 边界处理
        return Math.floor(num * (max - min + 1)) + min;
    }

    chunkArray<T>(arr: T[], numChunks: number): T[][] {
        // Validate input to prevent division by zero or invalid chunks
        if (numChunks <= 0) {
            throw new Error(`Invalid numChunks: ${numChunks}. Must be a positive integer.`)
        }
        
        if (arr.length === 0) {
            return []
        }
        
        const safeNumChunks = Math.max(1, Math.floor(numChunks))
        const chunkSize = Math.ceil(arr.length / safeNumChunks)
        const chunks: T[][] = []

        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize)
            chunks.push(chunk)
        }

        return chunks
    }

    stringToMs(input: string | number): number {
        const milisec = ms(input.toString())
        if (!milisec) {
            throw new Error('The string provided cannot be parsed to a valid time! Use a format like "1 min", "1m" or "1 minutes"')
        }
        return milisec
    }

}