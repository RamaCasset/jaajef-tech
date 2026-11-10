// "Salon : Teranga Racer" shows TR, not S: (the word Salon is not part of the project's name).
export const initialsOf = (name: string) => name.replace(/^Salon\s*:\s*/i, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w.slice(0, 1)).join('').toUpperCase()
