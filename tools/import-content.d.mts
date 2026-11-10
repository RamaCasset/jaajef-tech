export function parseCsv(text: string): string[][]
export function readTable(text: string): Record<string, string>[]
export function build(tables: { quests?: Record<string, string>[]; tests?: Record<string, string>[]; paths?: Record<string, string>[]; steps?: Record<string, string>[] }): { sql: string | null; errors: string[] }
